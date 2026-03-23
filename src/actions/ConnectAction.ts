import streamDeck, {
	action,
	KeyDownEvent,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";

import WebSocket from "ws";
import {ConnectionManager} from "../ConnectionManager";

@action({ UUID: "com.mgieseking.doremotedeck.connect" })
export class ConnectAction extends SingletonAction<Settings> {
	private instances = new Map<string, any>();

	constructor (private readonly conn: ConnectionManager) {
		super();
		this.conn.onStateChange((s) => this.updateTitle(s));
	}

	override onWillAppear(ev: WillAppearEvent): void {
		this.instances.set(ev.action.id, ev.action);
		ev.action.setTitle(this.conn.getState() === "connected" ? "Dis-\nconnect" : "Connect");
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
        this.instances.delete(ev.action.id);
    }

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		var status = this.conn.getState();
		if (status === "connected")
			this.conn.disconnect();
		else {
			status = this.conn.connect();
			if (this.conn.getState() === "offline")
				await ev.action.showAlert();
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<any, Settings>): Promise<void> {
        streamDeck.ui.sendToPropertyInspector({
            port:  this.conn.getPort(),
            token: this.conn.getSessionToken(),
            version: this.conn.getDoricoVersion()
        });
    }

	private updateTitle (status: string) {
		for (const inst of this.instances.values())
			inst.setTitle(status === "connected" ? "Dis-\nconnect" : "Connect");
	}
}

type Settings = {
    port: string,
    token: string,
    version: string;
};