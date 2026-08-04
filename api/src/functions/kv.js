const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER_NAME = "whbl-comps-data";
let containerClientPromise = null;

function getContainerClient() {
  if (!containerClientPromise) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured");
    }
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    containerClientPromise = containerClient
      .createIfNotExists()
      .then(() => containerClient);
  }
  return containerClientPromise;
}

// Keys arrive as arbitrary strings (e.g. "whbl-tournaments-v1"); turn them
// into a safe blob name so nothing can escape the container.
function blobNameFor(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}.json`;
}

app.http("kv", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "kv",
  handler: async (request, context) => {
    let containerClient;
    try {
      containerClient = await getContainerClient();
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: "storage not configured" } };
    }

    if (request.method === "GET") {
      const key = request.query.get("key");
      if (!key) return { status: 400, jsonBody: { error: "key query param required" } };

      const blockBlobClient = containerClient.getBlockBlobClient(blobNameFor(key));
      try {
        const downloadBuffer = await blockBlobClient.downloadToBuffer();
        return {
          status: 200,
          jsonBody: { key, value: downloadBuffer.toString("utf-8") },
        };
      } catch (err) {
        if (err.statusCode === 404) {
          return { status: 404, jsonBody: { error: "not found" } };
        }
        context.error(err);
        return { status: 500, jsonBody: { error: "read failed" } };
      }
    }

    // POST
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "invalid JSON body" } };
    }
    const { key, value } = body || {};
    if (!key || value === undefined) {
      return { status: 400, jsonBody: { error: "key and value are required" } };
    }

    const blockBlobClient = containerClient.getBlockBlobClient(blobNameFor(key));
    const data = Buffer.from(String(value), "utf-8");
    try {
      await blockBlobClient.upload(data, data.length, { overwrite: true });
      return { status: 200, jsonBody: { key, ok: true } };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: "write failed" } };
    }
  },
});
