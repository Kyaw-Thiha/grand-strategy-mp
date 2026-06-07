/**
 * IMPORTANT:
 * ---------
 * Do not manually edit this file if you'd like to host your server on Colyseus Cloud
 *
 * If you're self-hosting, you can see "Raw usage" from the documentation.
 * 
 * See: https://docs.colyseus.io/server
 */
import { listen } from "@colyseus/tools";
import { Encoder } from "@colyseus/schema";

// Colyseus default buffer is 8 KB — too small for 60+ divisions with full schema.
// Bump to 256 KB so state patches encode without overflow.
Encoder.BUFFER_SIZE = 256 * 1024;

// Import Colyseus config
import app from "./app.config.js";

// Create and listen on 2567 (or PORT environment variable.)
listen(app);
