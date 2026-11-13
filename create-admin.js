
require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const User = require('./models/User');

async function main() {
  if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
    throw new Error('MONGO_URI or JWT_SECRET is missing in .env');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const name = (await rl.question('Admin name: ')).trim();
    const email = (await rl.question('Admin email: ')).trim().toLowerCase();
    const password = await rl.question('Create a strong admin password: ');

    if (!name || !email.includes('@') || password.length < 12) {
      throw new Error('Enter a name, valid email and password of at least 12 characters.');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const existing = await User.findOne({ email });

    if (existing) {
      throw new Error(
        `An account with this email already exists (role: ${existing.role}). No changes made.`
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'admin'
    });

    console.log('Admin account created successfully.');
  } finally {
    rl.close();
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error('Admin setup failed:', error.message);
  process.exitCode = 1;
});
