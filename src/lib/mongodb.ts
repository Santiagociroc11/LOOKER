import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB || 'looker';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongoDb(): Promise<Db> {
    if (db) return db;
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
    return db;
}

export async function closeMongo(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}
