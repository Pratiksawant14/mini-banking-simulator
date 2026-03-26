const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'mbts';

let db;

async function getDb() {
  if (!db) {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
  }
  return db;
}

// GET /accounts — fetch all accounts
const getAllAccounts = async (req, res) => {
  try {
    const database = await getDb();
    const accounts = await database.collection('accounts').find({}, { projection: { _id: 0 } }).toArray();
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /accounts/:account_id — fetch one account by account_id field
const getAccountById = async (req, res) => {
  try {
    const { account_id } = req.params;
    const database = await getDb();
    const account = await database.collection('accounts').findOne(
      { account_id },
      { projection: { _id: 0 } }
    );
    if (!account) {
      return res.status(404).json({ success: false, error: `Account ${account_id} not found` });
    }
    res.json({ success: true, account });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /accounts — create a new account
const createAccount = async (req, res) => {
  try {
    const { account_id, customer_name, balance } = req.body;

    // Validation
    if (!account_id || !customer_name || balance === undefined) {
      return res.status(400).json({
        success: false,
        error: 'account_id, customer_name, and balance are required'
      });
    }
    if (typeof balance !== 'number' || balance < 0) {
      return res.status(400).json({ success: false, error: 'balance must be a non-negative number' });
    }

    const database = await getDb();

    // Check for duplicate account_id
    const existing = await database.collection('accounts').findOne({ account_id });
    if (existing) {
      return res.status(409).json({ success: false, error: `Account ${account_id} already exists` });
    }

    const newAccount = {
      account_id,
      customer_name,
      balance,
      status: 'active'
    };

    await database.collection('accounts').insertOne(newAccount);
    res.status(201).json({ success: true, account: { account_id, customer_name, balance, status: 'active' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = { getAllAccounts, getAccountById, createAccount };
