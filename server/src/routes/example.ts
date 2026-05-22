import type { FastifyPluginAsync } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ExampleItem {
  id: string;
  name: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// In-memory store (replace with a real DB via Drizzle when ready)
// ---------------------------------------------------------------------------
const items: ExampleItem[] = [
  { id: "1", name: "First item", createdAt: new Date().toISOString() },
  { id: "2", name: "Second item", createdAt: new Date().toISOString() },
];

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export const exampleRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/items */
  fastify.get("/items", async (_request, reply) => {
    return reply.send({ data: items });
  });

  /** GET /api/items/:id */
  fastify.get<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
    const item = items.find((i) => i.id === request.params.id);
    if (!item) {
      return reply.status(404).send({ error: "Item not found" });
    }
    return reply.send({ data: item });
  });

  /** POST /api/items */
  fastify.post<{ Body: { name: string } }>("/items", async (request, reply) => {
    const { name } = request.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
      return reply.status(400).send({ error: "name is required" });
    }
    const newItem: ExampleItem = {
      id: String(Date.now()),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    items.push(newItem);
    return reply.status(201).send({ data: newItem });
  });

  /** DELETE /api/items/:id */
  fastify.delete<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
    const idx = items.findIndex((i) => i.id === request.params.id);
    if (idx === -1) {
      return reply.status(404).send({ error: "Item not found" });
    }
    items.splice(idx, 1);
    return reply.status(204).send();
  });
};
