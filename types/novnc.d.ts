declare module "@novnc/novnc/lib/rfb.js" {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    focus(): void;
    blur(): void;
    disconnect(): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  }
}
