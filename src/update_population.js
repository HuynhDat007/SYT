require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const rawData = `1	Phường An Tịnh	50.042
2	Phường Bình Minh	54.247
3	Phường Gia Lộc	37.068
4	Phường Gò Dầu	65.802
5	Phường Hoà Thành	40.336
6	Phường Khánh Hậu	26.448
7	Phường Kiến Tường	23.154
8	Phường Long An	99.999
9	Phường Long Hoa	104.324
10	Phường Ninh Thạnh	50.167
11	Phường Tân An	31.947
12	Phường Tân Ninh	85.686
13	Phường Thanh Điền	43.155
14	Phường Trảng Bàng	45.843
15	Xã An Lục Long	29.285
16	Xã An Ninh	37.482
17	Xã Bến Cầu	48.980
18	Xã Bến Lức	53.877
19	Xã Bình Đức	35.269
20	Xã Bình Hiệp	37.482
21	Xã Bình Hòa	13.658
22	Xã Bình Thành	10.733
23	Xã Cần Đước	49.770
24	Xã Cần Giuộc	70.814
25	Xã Cầu Khởi	24.640
26	Xã Châu Thành	51.354
27	Xã Dương Minh Châu	26.426
28	Xã Đông Thành	47.820
29	Xã Đức Hòa	22.981
30	Xã Đức Huệ	30.449
31	Xã Đức Lập	35.608
32	Xã Hảo Đước	32.740
33	Xã Hậu Nghĩa	45.949
34	Xã Hậu Thạnh	19.553
35	Xã Hiệp Hoà	32.590
36	Xã Hoà Hội	14.279
37	Xã Hòa Khánh	35.125
38	Xã Hưng Điền	19.565
39	Xã Hưng Thuận	25.463
40	Xã Khánh Hưng	18.214
41	Xã Long Cang	29.224
42	Xã Long Chữ	31.470
43	Xã Long Hựu	17.845
44	Xã Long Thuận	28.991
45	Xã Lộc Ninh	24.813
46	Xã Lương Hoà	23.018
47	Xã Mộc Hóa	17.000
48	Xã Mỹ An	20.884
49	Xã Mỹ Hạnh	54.083
50	Xã Mỹ Lệ	36.021
51	Xã Mỹ Lộc	39.161
52	Xã Mỹ Quý	28.446
53	Xã Mỹ Thạnh	26.809
54	Xã Mỹ Yên	42.799
55	Xã Nhơn Hòa Lập	20.079
56	Xã Nhơn Ninh	27.062
57	Xã Nhựt Tảo	30.071
58	Xã Ninh Điền	23.445
59	Xã Phước Chỉ	31.218
60	Xã Phước Lý	40.400
61	Xã Phước Thạnh	43.618
62	Xã Phước Vinh	23.019
63	Xã Phước Vĩnh Tây	27.343
64	Xã Rạch Kiến	35.361
65	Xã Tầm Vu	35.779
66	Xã Tân Biên	37.287
67	Xã Tân Châu	23.540
68	Xã Tân Đông	27.491
69	Xã Tân Hòa	24.268
70	Xã Tân Hội	21.828
71	Xã Tân Hưng	18.028
72	Xã Tân Lân	33.025
73	Xã Tân Lập	17.016
74	Xã Tân Long	14.090
75	Xã Tân Phú	30.197
76	Xã Tân Tập	44.326
77	Xã Tân Tây	19.597
78	Xã Tân Thành	28.203
79	Xã Tân Thạnh	26.011
80	Xã Tân Trụ	26.509
81	Xã Thạnh Bình	31.066
82	Xã Thạnh Đức	44.318
83	Xã Thạnh Hóa	16.701
84	Xã Thạnh Lợi	23.810
85	Xã Thạnh Phước	22.314
86	Xã Thủ Thừa	43.221
87	Xã Thuận Mỹ	38.978
88	Xã Trà Vong	24.526
89	Xã Truông Mít	39.536
90	Xã Tuyên Bình	19.501
91	Xã Tuyên Thạnh	15.353
92	Xã Vàm Cỏ	25.062
93	Xã Vĩnh Châu	13.131
94	Xã Vĩnh Công	22.827
95	Xã Vĩnh Hưng	23.449
96	Xã Vĩnh Thạnh	12.695`;

function stdTone(str) {
  if (!str) return '';
  return str
    .normalize('NFC')
    .replace(/oà/g, 'òa')
    .replace(/oá/g, 'óa')
    .replace(/oả/g, 'ỏa')
    .replace(/oã/g, 'õa')
    .replace(/oạ/g, 'ọa')
    .replace(/uý/g, 'úy')
    .replace(/uỳ/g, 'ùy')
    .replace(/uỷ/g, 'ủy')
    .replace(/uỹ/g, 'ũy')
    .replace(/uỵ/g, 'ụy')
    .replace(/Oà/g, 'Òa')
    .replace(/Oá/g, 'Óa')
    .replace(/Oả/g, 'Ỏa')
    .replace(/Oã/g, 'Õa')
    .replace(/Oạ/g, 'Ọa')
    .replace(/Uý/g, 'Úy')
    .replace(/Uỳ/g, 'Ùy')
    .replace(/Uỷ/g, 'Ủy')
    .replace(/Uỹ/g, 'Ũy')
    .replace(/Uỵ/g, 'Ụy');
}

async function update() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB for update...');

    const lines = rawData.trim().split('\n');
    const targetMap = {};
    lines.forEach(l => {
      const parts = l.split('\t');
      if (parts.length >= 3) {
        const rawNum = parts[2].trim().replace(/\./g, '');
        const num = parseInt(rawNum);
        const name = parts[1].trim();
        targetMap[stdTone(name)] = num;
      }
    });

    const units = await User.find({ role: 'unit' });
    let updatedCount = 0;
    
    for (const unit of units) {
      const stdName = stdTone(unit.unitName);
      const targetVal = targetMap[stdName];
      
      if (targetVal !== undefined) {
        if (unit.residentPopulation !== targetVal) {
          const oldVal = unit.residentPopulation;
          unit.residentPopulation = targetVal;
          await unit.save();
          console.log(`Updated: "${unit.unitName}" population ${oldVal} -> ${targetVal}`);
          updatedCount++;
        } else {
          console.log(`Skipped (already correct): "${unit.unitName}" (${targetVal})`);
        }
      } else {
        console.warn(`Warning: DB unit "${unit.unitName}" not found in update list.`);
      }
    }

    console.log(`\nUpdate completed! Total units updated: ${updatedCount}/${units.length}`);
    process.exit(0);
  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }
}

update();
