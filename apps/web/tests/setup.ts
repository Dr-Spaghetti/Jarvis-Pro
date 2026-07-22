import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { MockWebSocket } from "./test-utils/appTestHarness";

afterEach(() => {
  cleanup();
});

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const canvasContextStub = {
  imageSmoothingEnabled: true,
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  font: "",
  textAlign: "left" as CanvasTextAlign,
  textBaseline: "alphabetic" as CanvasTextBaseline,
  shadowColor: "",
  shadowBlur: 0,
  globalAlpha: 1,
  clearRect() {},
  fillRect() {},
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  quadraticCurveTo() {},
  lineTo() {},
  closePath() {},
  stroke() {},
  fill() {},
  ellipse() {},
  arc() {},
  scale() {},
  translate() {},
  clip() {},
  setLineDash() {},
  fillText() {},
  measureText() {
    return { width: 0 };
  },
  createRadialGradient() {
    return { addColorStop() {} };
  },
  createLinearGradient() {
    return { addColorStop() {} };
  },
};

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => canvasContextStub,
});

globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
