import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vibe');
    console.log('Connected to MongoDB');

    // Get email and password from command line arguments or use defaults
    const email = process.argv[2] || 'admin@vibe.com';
    const password = process.argv[3] || 'admin123';
    const fullName = process.argv[4] || 'Admin User';

    // Check if user already exists
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user to admin
      user.role = 'admin';
      if (password && password !== 'admin123') {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
      }
      user.fullName = fullName;
      await user.save();
      console.log(`✅ User ${email} has been promoted to admin!`);
    } else {
      // Create new admin user
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      user = await User.create({
        email,
        password: hashedPassword,
        fullName,
        role: 'admin',
      });

      console.log(`✅ Admin user created successfully!`);
    }

    console.log('\n📋 Admin Details:');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Name: ${fullName}`);
    console.log(`   Role: ${user.role}`);
    console.log('\n⚠️  Please change the password after first login!');

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error creating admin:', error.message);
    process.exit(1);
  }
};

createAdmin();

