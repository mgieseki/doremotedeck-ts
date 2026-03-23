import streamDeck from "@elgato/streamdeck";
import WebSocket from "ws";

export type GlobalSettings = {
    port?: string;
    token?: string;
    autoReconnect?: boolean;
};

const defaultGlobalSettings: GlobalSettings = {
    port: "4560",
    token: "",
    autoReconnect: true,
};

export type SessionState = "disconnected" | "connected" | "denied" | "offline";

export class ConnectionManager {
    private ws: WebSocket | null = null;
    private state: SessionState = "disconnected";
    private globals: GlobalSettings = defaultGlobalSettings;
    private stateListeners = new Set<(s: SessionState) => void>();
    private doricoVersion : string = "";
    private doricoTerminated = false;
    private autoConnecting = false;

    constructor() {
        this.loadGlobalSettings();
    }

    private async loadGlobalSettings() {
        const loaded = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
        this.globals = { ...defaultGlobalSettings, ...(loaded ?? {}) };
    }

    setGlobalSettings(s: GlobalSettings) { this.globals = { ...this.globals, ...s }; }
    getGlobalSettings() {return this.globals;}
    getPort() {return this.globals.port;}
    getSessionToken() {return this.globals.token;}
    getState() {return this.state;}
    getDoricoVersion() {return this.doricoVersion;}

    async autoConnect () {
        if (!this.autoConnecting && this.globals.token && this.globals.autoReconnect) {
            await this.waitForDorico();
            this.connect();
        }
    }

    connect() {
        if (this.state === "connected")
            return this.state;
        const clientName = "Dorico Remote Deck";
        const ws = new WebSocket("ws://127.0.0.1:" + this.globals.port);
        this.ws = ws;
        this.doricoTerminated = false;

        ws.onopen = () => {
            const connectMsg: Record<string, unknown> = {
                message: "connect",
                handshakeVersion: "1.0",
                clientName : clientName,
            };
            if (this.globals.token)
                connectMsg.sessionToken = this.globals.token;
            ws.send(JSON.stringify(connectMsg));
        };

        ws.onclose = async (ev: WebSocket.CloseEvent) => {
            if (this.state === "connected") {
                this.doricoTerminated = true;
                this.setState("offline");
                this.autoConnect();
            }
        }

        ws.onerror = async (ev: WebSocket.ErrorEvent) => {
            this.setState("offline");
        }

        ws.onmessage = (ev: WebSocket.MessageEvent) => {
            const msg = this.parseResponse(ev.data);
            streamDeck.logger.info(msg);
            switch (msg.message) {
                case "sessiontoken": {
                    this.globals.token = msg.sessionToken;
                    ws.send(JSON.stringify({
                        message: "acceptsessiontoken",
                        sessionToken: this.globals.token,
                    }));
                    return this.state;
                }
                case "response":
                    if (msg.code === "kConnected") {
                        this.ws?.send(JSON.stringify({
                            message: "getappinfo",
                            info: "version"
                        }));
                        this.setState("connected");
                    }
                    break;
                case "version":
                    this.doricoVersion = msg.variant + " " + msg.number;
                    break;
            }
        };
        return this.state;
    }

    disconnect() {
        if (this.state !== "connected")
            return;
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                message: "disconnect"
            }));
        }
        this.setState("disconnected");
        this.ws?.close();
    }

    sendCommand(doricoCommand: string) {
        doricoCommand = doricoCommand.trim();
        if (this.state === "connected" && doricoCommand.length > 0) {
            this.ws?.send(JSON.stringify({
                message: "command",
                command: doricoCommand
            }));
        }
    }

    onStateChange(fn: (s: SessionState) => void) {
        this.stateListeners.add(fn);
        return () => this.stateListeners.delete(fn);
    }

    private setState(state: SessionState) {
        if (this.state === state) return;
        this.state = state;
        for (const fn of this.stateListeners)
            fn(state);
    }

    private parseResponse (data: WebSocket.Data) {
        try {
            return JSON.parse(data.toString("utf8"));
        }
        catch {
            return;
        }
    }

    private waitForDorico(retryIntervalMs: number=3000, timeoutMs: number=30000): Promise<void> {
        streamDeck.logger.info("waiting for Dorico");
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const attempt = () => {
                if (timeoutMs > 0 && Date.now() - startTime >= timeoutMs) {
                    reject(new Error(`Dorico not reachable after ${timeoutMs}ms`));
                    return;
                }
                const ws = new WebSocket("ws://127.0.0.1:"+this.globals.port);

                ws.addEventListener("open", () => {
                    ws.close();
                    resolve();
                });

                ws.addEventListener("error", () => {
                    ws.close();
                    setTimeout(attempt, retryIntervalMs);
                });
            };

            attempt();
        });
    }
}