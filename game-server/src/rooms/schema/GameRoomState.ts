import { Schema, MapSchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") userId: string = "";
  @type("string") steamId: string = "";
  @type("boolean") hasHostPass: boolean = false;
}

export class GameRoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
