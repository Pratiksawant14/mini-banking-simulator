const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

const seedData = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB Connected for seeding...');

    const db = mongoose.connection.db;

    // Drop and recreate all 4 collections
    const collections = ['accounts', 'transactions', 'locks', 'schedules'];
    for (const col of collections) {
      const exists = await db.listCollections({ name: col }).hasNext();
      if (exists) {
        await db.collection(col).drop();
        console.log(`🗑️  Dropped collection: ${col}`);
      }
      await db.createCollection(col);
      console.log(`✅ Created collection: ${col}`);
    }

    // Seed 3 sample accounts
    const accounts = [
      { account_id: 'ACC1001', customer_name: 'Alice',   balance: 5000, status: 'active' },
      { account_id: 'ACC1002', customer_name: 'Bob',     balance: 3000, status: 'active' },
      { account_id: 'ACC1003', customer_name: 'Charlie', balance: 7000, status: 'active' },
    ];

    await db.collection('accounts').insertMany(accounts);
    console.log(`🌱 Seeded ${accounts.length} accounts successfully.`);

    console.log('\n🎉 Database seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  }
};

seedData();
