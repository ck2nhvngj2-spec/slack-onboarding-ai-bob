import { ChromaClient } from "chromadb";

import * as fs from "fs";

import * as path from "path";



const client = new ChromaClient({ path: "http://localhost:8000" });

const repoPath = path.join(__dirname, "../../seed-repo");



async function ingestContext() {

  console.log("Initializing ChromaDB collection...");

  const collection = await client.getOrCreateCollection({ name: "project-corpus" });



  const files = fs.readdirSync(repoPath);

  let idCounter = 1;



  for (const file of files) {

    const filePath = path.join(repoPath, file);

    const content = fs.readFileSync(filePath, "utf-8");

    

    // Basic 500-character chunking for the Document Understanding grounding

    const chunks = content.match(/[\s\S]{1,500}/g) || [];

    

    for (const chunk of chunks) {

      await collection.upsert({

        ids: [`chunk-${idCounter++}`],

        documents: [chunk],

        metadatas: [{ source: file }]

      });

    }

    console.log(`Ingested ${file}`);

  }

  console.log("Context store fully loaded. You are ready for IBM Bob.");

}



ingestContext().catch(console.error);