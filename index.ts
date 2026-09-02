import index from "./client/index.html";
import { DEVELOPMENT, PORT } from "./server/config.ts";
import { getToken, listModels } from "./server/aps.ts";

const server = Bun.serve({
  port: PORT,
  development: DEVELOPMENT,

  routes: {
    "/": index,

    "/api/auth/token": {
      GET: async () => Response.json(await getToken("viewables:read"))
    },

    "/api/models": {
      GET: async () => Response.json(await listModels())
    }
  }
});

console.log(`[server] listening on ${server.url}`);
