import type { PreloadApi } from "@kanban/shared";
import type { JSX as ReactJSX } from "react";

declare global {
  interface Window {
    api?: PreloadApi;
  }

  namespace JSX {
    type Element = ReactJSX.Element;
    interface IntrinsicElements extends ReactJSX.IntrinsicElements { }
  }
}

export { };
