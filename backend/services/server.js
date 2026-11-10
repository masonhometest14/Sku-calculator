import { createServer } from "node:http";
import { DB_PATH } from "./database.js";
import { handle } from "./api.js";

const PORT = Number(process.env.PORT || 8000);
const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(
    "Mason Home API at http://localhost:" + PORT + " · SQLite: " + DB_PATH,
  ),
);
