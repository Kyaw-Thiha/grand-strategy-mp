import {
    defineRoom,
    monitor,
    createRouter,
    createEndpoint,
} from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";

/**
 * Import your Room files
 */
import { GameRoom } from "./rooms/GameRoom.js";

// Export a plain config object instead of a Server instance so that boot() and
// listen() each call buildServerFromOptions(), creating a fresh Server + transport
// on every invocation. This lets test suites reuse the same imported module
// without the previous suite's closed transport poisoning the next boot().
export default {
    initializeTransport: () => new WebSocketTransport({
        maxPayload: 1 * 1024 * 1024, // 1 MB — Colyseus default is 4 KB which rejects long move orders
    }),

    rooms: {
        game_room: defineRoom(GameRoom)
    },

    routes: createRouter({
        api_hello: createEndpoint("/api/hello", { method: "GET", }, async (ctx) => {
            return { message: "Hello World" }
        })
    }),

    initializeExpress: (app: any) => {
        app.get("/hi", (req: any, res: any) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        app.use("/monitor", monitor());
    }
};