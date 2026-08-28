// ============================================================
//  store.js — permanent storage (MongoDB Atlas)
//  The server loads this only if present; if MONGO_URL is unset
//  or the connection fails, the server keeps running in memory.
// ============================================================

let trips = null;       // trips collection
let profiles = null;    // profiles collection
let ready = false;

async function init(mongoUrl) {
  if (!mongoUrl) { console.log('  storage: MONGO_URL not set — memory only'); return; }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db('wanderers');
    trips = db.collection('trips');
    profiles = db.collection('profiles');
    await trips.createIndex({ ownerId: 1, startedAt: -1 });
    await profiles.createIndex({ ownerId: 1 }, { unique: true });
    ready = true;
    console.log('  storage: connected to MongoDB — trips & profiles are permanent ✓');
  } catch (e) {
    console.error('  storage: MongoDB connection failed —', e.message);
    trips = null; profiles = null; ready = false;
  }
}

// ---- trips ----
async function saveTrip(trip) {
  if (!ready || !trips) { trip._id = 'mem-' + Date.now(); return trip; }
  const res = await trips.insertOne(trip);
  trip._id = res.insertedId;
  return trip;
}
async function listTrips(ownerId, limit = 50) {
  if (!ready || !trips) return [];
  return trips.find({ ownerId: String(ownerId) }).sort({ startedAt: -1 }).limit(limit).toArray();
}
async function getTrip(id, ownerId) {
  if (!ready || !trips) return null;
  const { ObjectId } = require('mongodb');
  let _id; try { _id = new ObjectId(id); } catch { return null; }
  return trips.findOne({ _id, ownerId: String(ownerId) });
}
async function deleteTrip(id, ownerId) {
  if (!ready || !trips) return false;
  const { ObjectId } = require('mongodb');
  let _id; try { _id = new ObjectId(id); } catch { return false; }
  const r = await trips.deleteOne({ _id, ownerId: String(ownerId) });
  return r.deletedCount > 0;
}

// ---- profiles ----
async function saveProfile(ownerId, name, photo, status) {
  const doc = {
    ownerId: String(ownerId),
    name: String(name || 'Wanderer').slice(0, 24),
    photo: (typeof photo === 'string' && photo.length < 60000) ? photo : null,
    status: (typeof status === 'string') ? status.slice(0, 40) : '',
    updatedAt: Date.now()
  };
  if (!ready || !profiles) return doc;
  await profiles.updateOne({ ownerId: doc.ownerId }, { $set: doc }, { upsert: true });
  return doc;
}
async function getProfiles(ownerIds) {
  const ids = [...new Set((ownerIds || []).map(String))].slice(0, 100);
  const out = {};
  if (!ready || !profiles) return out;
  const docs = await profiles.find({ ownerId: { $in: ids } }).toArray();
  for (const d of docs) out[d.ownerId] = { name: d.name, photo: d.photo, status: d.status };
  return out;
}

module.exports = { init, saveTrip, listTrips, getTrip, deleteTrip, saveProfile, getProfiles };
