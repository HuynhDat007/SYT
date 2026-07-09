require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const HealthCenter = require('./models/HealthCenter');
const DailyReport = require('./models/DailyReport');
const AuditLog = require('./models/AuditLog');

const unitsList = [
  "Xã Hưng Điền", "Xã Vĩnh Thạnh", "Xã Tân Hưng", "Xã Vĩnh Châu", "Xã Tuyên Bình",
  "Xã Vĩnh Hưng", "Xã Khánh Hưng", "Xã Tuyên Thạnh", "Xã Bình Hiệp", "Phường Kiến Tường",
  "Xã Bình Hòa", "Xã Mộc Hóa", "Xã Hậu Thạnh", "Xã Nhơn Hòa Lập", "Xã Nhơn Ninh",
  "Xã Tân Thạnh", "Xã Bình Thành", "Xã Thạnh Phước", "Xã Thạnh Hóa", "Xã Tân Tây",
  "Xã Thủ Thừa", "Xã Mỹ An", "Xã Mỹ Thạnh", "Xã Tân Long", "Xã Mỹ Quý",
  "Xã Đông Thành", "Xã Đức Huệ", "Xã An Ninh", "Xã Hiệp Hòa", "Xã Hậu Nghĩa",
  "Xã Hòa Khánh", "Xã Đức Lập", "Xã Mỹ Hạnh", "Xã Đức Hòa", "Xã Thạnh Lợi",
  "Xã Bình Đức", "Xã Lương Hòa", "Xã Bến Lức", "Xã Mỹ Yên", "Xã Long Cang",
  "Xã Rạch Kiến", "Xã Mỹ Lệ", "Xã Tân Lân", "Xã Cần Đước", "Xã Long Hựu",
  "Xã Phước Lý", "Xã Mỹ Lộc", "Xã Cần Giuộc", "Xã Phước Vĩnh Tây", "Xã Tân Tập",
  "Xã Vàm Cỏ", "Xã Tân Trụ", "Xã Nhựt Tảo", "Xã Thuận Mỹ", "Xã An Lục Long",
  "Xã Tầm Vu", "Xã Vĩnh Công", "Phường Long An", "Phường Tân An", "Phường Khánh Hậu",
  "Phường Tân Ninh", "Phường Bình Minh", "Phường Ninh Thạnh", "Phường Long Hoa", "Phường Hòa Thành",
  "Phường Thanh Điền", "Phường Trảng Bàng", "Phường An Tịnh", "Phường Gò Dầu", "Phường Gia Lộc",
  "Xã Hưng Thuận", "Xã Phước Chỉ", "Xã Thạnh Đức", "Xã Phước Thạnh", "Xã Truông Mít",
  "Xã Lộc Ninh", "Xã Cầu Khởi", "Xã Dương Minh Châu", "Xã Tân Đông", "Xã Tân Châu",
  "Xã Tân Phú", "Xã Tân Hội", "Xã Tân Thành", "Xã Tân Hòa", "Xã Tân Lập",
  "Xã Tân Biên", "Xã Thạnh Bình", "Xã Trà Vong", "Xã Phước Vinh", "Xã Hoà Hội",
  "Xã Ninh Điền", "Xã Châu Thành", "Xã Hảo Đước", "Xã Long Chữ", "Xã Long Thuận",
  "Xã Bến Cầu"
];

const populationData = {
  "An Lục Long": 29285,
  "An Ninh": 37482,
  "Bến Cầu": 48980,
  "Bến Lức": 53877,
  "Bình Đức": 35269,
  "Bình Hiệp": 37482,
  "Bình Hòa": 13658,
  "Bình Thành": 10733,
  "Cần Đước": 49770,
  "Cần Giuộc": 70814,
  "Cầu Khởi": 24640,
  "Châu Thành": 51354,
  "Dương Minh Châu": 26426,
  "Đông Thành": 47820,
  "Đức Hòa": 22981,
  "Đức Huệ": 30449,
  "Đức Lập": 35608,
  "Hảo Đước": 32740,
  "Hậu Nghĩa": 45949,
  "Hậu Thạnh": 19553,
  "Hiệp Hoà": 32590,
  "Hoà Hội": 14279,
  "Hòa Khánh": 35125,
  "Hưng Điền": 19565,
  "Hưng Thuận": 25463,
  "Khánh Hưng": 18214,
  "Long Cang": 29224,
  "Long Chữ": 31470,
  "Long Hựu": 17845,
  "Long Thuận": 28991,
  "Lộc Ninh": 24813,
  "Lương Hoà": 23018,
  "Mộc Hóa": 17000,
  "Mỹ An": 20884,
  "Mỹ Hạnh": 54083,
  "Mỹ Lệ": 36021,
  "Mỹ Lộc": 39161,
  "Mỹ Quý": 28446,
  "Mỹ Thạnh": 26809,
  "Mỹ Yên": 42799,
  "Nhơn Hòa Lập": 20079,
  "Nhơn Ninh": 27062,
  "Nhựt Tảo": 30071,
  "Ninh Điền": 23445,
  "Phước Chỉ": 31218,
  "Phước Lý": 40400,
  "Phước Thạnh": 43618,
  "Phước Vinh": 23019,
  "Phước Vĩnh Tây": 27343,
  "Rạch Kiến": 35361,
  "Tầm Vu": 35779,
  "Tân Biên": 37287,
  "Tân Châu": 23540,
  "Tân Đông": 27491,
  "Tân Hòa": 24268,
  "Tân Hội": 21828,
  "Tân Hưng": 18028,
  "Tân Lân": 33025,
  "Tân Lập": 17016,
  "Tân Long": 14090,
  "Tân Phú": 30197,
  "Tân Tập": 44326,
  "Tân Tây": 19597,
  "Tân Thành": 28203,
  "Tân Thạnh": 26011,
  "Tân Trụ": 26509,
  "Thạnh Bình": 31066,
  "Thạnh Đức": 44318,
  "Thạnh Hóa": 16701,
  "Thạnh Lợi": 23810,
  "Thạnh Phước": 22314,
  "Thủ Thừa": 43221,
  "Thuận Mỹ": 38978,
  "Trà Vong": 24526,
  "Truông Mít": 39536,
  "Tuyên Bình": 19501,
  "Tuyên Thạnh": 15353,
  "Vàm Cỏ": 25062,
  "Vĩnh Châu": 13131,
  "Vĩnh Công": 22827,
  "Vĩnh Hưng": 23449,
  "Vĩnh Thạnh": 12695,
  "An Tịnh": 50042,
  "Bình Minh": 54247,
  "Gia Lộc": 37068,
  "Gò Dầu": 65802,
  "Hoà Thành": 40336,
  "Khánh Hậu": 26448,
  "Kiến Tường": 23154,
  "Long An": 99999,
  "Long Hoa": 104324,
  "Ninh Thạnh": 50167,
  "Tân An": 31947,
  "Tân Ninh": 85686,
  "Thanh Điền": 43155,
  "Trảng Bàng": 45843
};

// Normalize population data keys using NFC for direct comparison
const normPopData = {};
Object.keys(populationData).forEach(key => {
  normPopData[key.normalize('NFC').trim()] = populationData[key];
});

function cleanName(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9]/g, ''); // remove everything else (spaces, dashes, etc.)
}

async function seed() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('Connected to database for seeding...');

    // Clear existing data
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await HealthCenter.deleteMany({});
    await DailyReport.deleteMany({});
    await AuditLog.deleteMany({});
    console.log('Cleaned database.');

    // 1. Create Admin
    const adminPasswordHash = await bcrypt.hash('admin123@SYT', 10);
    const adminUser = await User.create({
      username: 'admin',
      password: adminPasswordHash,
      role: 'admin',
      unitName: 'Sở Y Tế Tây Ninh',
      contactName: 'Ban Quản Trị',
      contactPhone: '0281234567',
      contactEmail: 'admin@syt.gov.vn'
    });
    console.log('Seeded Admin account successfully.');

    // 2. Create 96 Units
    const unitPasswordHash = await bcrypt.hash('VNPT2026', 10);
    const createdUnits = [];
    const usedUsernames = new Set();

    // Admin is a reserved username
    usedUsernames.add('admin');

    for (const unitName of unitsList) {
      let base = cleanName(unitName);
      let username = `${base}.tayninh`;
      let counter = 1;

      while (usedUsernames.has(username)) {
        counter++;
        username = `${base}${counter}.tayninh`;
      }

      usedUsernames.add(username);

      // Strip prefix "Xã" or "Phường" and look up population size
      const cleanLookupKey = unitName.replace(/^(Xã|Phường)\s+/, '').trim().normalize('NFC');
      const population = normPopData[cleanLookupKey] || 5000;

      const newUnit = await User.create({
        username,
        password: unitPasswordHash,
        role: 'unit',
        unitName,
        planTarget: 1000, // Default initial target, Admin can change later
        residentPopulation: population,
        firstHalfChecked: 0 // Default 0, Admin/Unit can change later
      });
      createdUnits.push(newUnit);
    }
    console.log(`Seeded ${createdUnits.length} Unit accounts successfully.`);

    // 3. Create a Default Health Center for each Unit
    console.log('Creating default Health Centers...');
    let centersCreated = 0;
    for (const unit of createdUnits) {
      const defaultCenterName = unit.unitName;
      await HealthCenter.create({
        name: defaultCenterName,
        unitId: unit._id
      });
      centersCreated++;
    }
    console.log(`Created ${centersCreated} default Health Centers.`);

    console.log('Database Seeding COMPLETE!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();
