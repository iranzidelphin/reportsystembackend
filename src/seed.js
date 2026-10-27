require('dotenv').config();

const bcrypt = require('bcryptjs'),
  connectDb = require('./config/db'),
  User = require('./models/User');

(async () => {
  await connectDb();

  const password = process.env.ADMIN_PIN || process.env.OWNER_PIN,
    phoneNumber = process.env.ADMIN_PHONE || '0788721005',
    name = process.env.ADMIN_NAME || process.env.OWNER_NAME || 'System Admin';

  if (!password || String(password).length < 8)
    throw new Error('ADMIN_PIN must contain at least 8 characters');

  const user = await User.findOneAndUpdate(
    { phoneNumber },
    {
      fullName: name,
      name,
      phoneNumber,
      passwordHash: await bcrypt.hash(password, 12),
      $unset: { pinHash: '' },
      role: 'ADMIN',
      status: 'ACTIVE'
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true
    }
  );

  console.log(`Admin ready: ${user.name} (${user.phoneNumber})`);
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
