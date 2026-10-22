require('dotenv').config();

const bcrypt = require('bcryptjs'),
  connectDb = require('./config/db'),
  User = require('./models/User');

(async () => {
  await connectDb();

  const pin = process.env.ADMIN_PIN || process.env.OWNER_PIN || '1234',
    phoneNumber = process.env.ADMIN_PHONE || '0788721005',
    name = process.env.ADMIN_NAME || process.env.OWNER_NAME || 'System Admin';

  if (!/^\d{4}$/.test(pin))
    throw new Error('ADMIN_PIN must contain four digits');

  const user = await User.findOneAndUpdate(
    { phoneNumber },
    {
      fullName: name,
      name,
      phoneNumber,
      pinHash: await bcrypt.hash(pin, 12),
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
