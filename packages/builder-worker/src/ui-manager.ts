import { Event } from "./event";

export const eventGroup = "ui-manager";

export interface Ready {
  type: "ready";
  width: number;
}

export interface Show {
  type: "show";
}

export interface Hide {
  type: "hide";
}
export interface Home {
  type: "home";
}

export type UIManagerCommand = Ready | Show | Hide | Home;

export function isUIManagerEvent(event: any): event is Event<UIManagerCommand> {
  return (
    typeof event === "object" &&
    "group" in event &&
    event.group === eventGroup &&
    "args" in event
  );
}