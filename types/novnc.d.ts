declare module "@novnc/novnc/lib/rfb.js" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: Record<string, unknown>,
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    focus(): void;
    blur(): void;
    disconnect(): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
    sendCredentials(creds: { password?: string; username?: string }): void;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  }
}
