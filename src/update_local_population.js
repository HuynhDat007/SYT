require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const rawData = `1	Phường An Tịnh	50.042	50.183
2	Phường Bình Minh	54.247	56.217
3	Phường Gia Lộc	37.068	37.068
4	Phường Gò Dầu	65.802	65.793
5	Phường Hoà Thành	40.336	36.428
6	Phường Khánh Hậu	26.448	28.965
7	Phường Kiến Tường	23.154	23.154
8	Phường Long An	99.999	109.229
9	Phường Long Hoa	104.324	104.221
10	Phường Ninh Thạnh	50.167	50.088
11	Phường Tân An	31.947	32.240
12	Phường Tân Ninh	85.686	89.360
13	Phường Thanh Điền	43.155	43.675
14	Phường Trảng Bàng	45.843	45.843
15	Xã An Lục Long	29.285	0
16	Xã An Ninh	37.482	37.482
17	Xã Bến Cầu	48.980	0
18	Xã Bến Lức	53.877	53.877
19	Xã Bình Đức	35.269	35.269
20	Xã Bình Hiệp	37.482	21.384
21	Xã Bình Hòa	13.658	0
22	Xã Bình Thành	10.733	8.834
23	Xã Cần Đước	49.770	0
24	Xã Cần Giuộc	70.814	68.926
25	Xã Cầu Khởi	24.640	0
26	Xã Châu Thành	51.354	0
27	Xã Dương Minh Châu	26.426	35.570
28	Xã Đông Thành	47.820	0
29	Xã Đức Hòa	22.981	47.820
30	Xã Đức Huệ	30.449	22.979
31	Xã Đức Lập	35.608	30.449
32	Xã Hảo Đước	32.740	0
33	Xã Hậu Nghĩa	45.949	47.006
34	Xã Hậu Thạnh	19.553	18.549
35	Xã Hiệp Hoà	32.590	32.624
36	Xã Hoà Hội	14.279	13.420
37	Xã Hòa Khánh	35.125	35.125
38	Xã Hưng Điền	19.565	17.663
39	Xã Hưng Thuận	25.463	25.463
40	Xã Khánh Hưng	18.214	18.214
41	Xã Long Cang	29.224	32.314
42	Xã Long Chữ	31.470	17.869
43	Xã Long Hựu	17.845	26.985
44	Xã Long Thuận	28.991	24.518
45	Xã Lộc Ninh	24.813	30082
46	Xã Lương Hoà	23.018	23.054
47	Xã Mộc Hóa	17.000	15.026
48	Xã Mỹ An	20.884	18.878
49	Xã Mỹ Hạnh	54.083	54.071
50	Xã Mỹ Lệ	36.021	0
51	Xã Mỹ Lộc	39.161	37.173
52	Xã Mỹ Quý	28.446	28.446
53	Xã Mỹ Thạnh	26.809	0
54	Xã Mỹ Yên	42.799	42.799
55	Xã Nhơn Hòa Lập	20.079	0
56	Xã Nhơn Ninh	27.062	0
57	Xã Nhựt Tảo	30.071	26.678
58	Xã Ninh Điền	23.445	23.406
59	Xã Phước Chỉ	31.218	31.216
60	Xã Phước Lý	40.400	0
61	Xã Phước Thạnh	43.618	43.618
62	Xã Phước Vinh	23.019	6.237
63	Xã Phước Vĩnh Tây	27.343	23.690
64	Xã Rạch Kiến	35.361	35.361
65	Xã Tầm Vu	35.779	35.692
66	Xã Tân Biên	37.287	36.744
67	Xã Tân Châu	23.540	23.385
68	Xã Tân Đông	27.491	23.947
69	Xã Tân Hòa	24.268	24.279
70	Xã Tân Hội	21.828	20.259
71	Xã Tân Hưng	18.028	0
72	Xã Tân Lân	33.025	0
73	Xã Tân Lập	17.016	17.016
74	Xã Tân Long	14.090	13.138
75	Xã Tân Phú	30.197	0
76	Xã Tân Tập	44.326	41.584
77	Xã Tân Tây	19.597	19.597
78	Xã Tân Thành	28.203	28.203
79	Xã Tân Thạnh	26.011	26.065
80	Xã Tân Trụ	26.509	26.509
81	Xã Thạnh Bình	31.066	29.014
82	Xã Thạnh Đức	44.318	44.318
83	Xã Thạnh Hóa	16.701	16.705
84	Xã Thạnh Lợi	23.810	23.810
85	Xã Thạnh Phước	22.314	22.287
86	Xã Thủ Thừa	43.221	40.042
87	Xã Thuận Mỹ	38.978	34.474
88	Xã Trà Vong	24.526	0
89	Xã Truông Mít	39.536	38.329
90	Xã Tuyên Bình	19.501	0
91	Xã Tuyên Thạnh	15.353	15.353
92	Xã Vàm Cỏ	25.062	22.787
93	Xã Vĩnh Châu	13.131	13.131
94	Xã Vĩnh Công	22.827	22.827
95	Xã Vĩnh Hưng	23.449	23.449
96	Xã Vĩnh Thạnh	12.695	10.244`;

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

async function run() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('Connected to database to update population...');

    const lines = rawData.trim().split('\n');
    const dataMap = {};
    lines.forEach(l => {
      const parts = l.split('\t');
      if (parts.length >= 4) {
        const name = parts[1].trim();
        const resPop = parseInt(parts[2].trim().replace(/\./g, '').replace(/,/g, ''));
        const locPop = parseInt(parts[3].trim().replace(/\./g, '').replace(/,/g, ''));
        dataMap[stdTone(name)] = { resPop, locPop };
      }
    });

    const units = await User.find({ role: 'unit' });
    console.log(`Loaded ${units.length} units to update.`);

    let updatedCount = 0;
    for (const unit of units) {
      const stdName = stdTone(unit.unitName);
      const target = dataMap[stdName];
      if (target) {
        let changed = false;
        if (unit.residentPopulation !== target.resPop) {
          unit.residentPopulation = target.resPop;
          changed = true;
        }
        if (unit.localManagedPopulation !== target.locPop) {
          unit.localManagedPopulation = target.locPop;
          changed = true;
        }

        if (changed) {
          await unit.save();
          console.log(`Updated "${unit.unitName}": resident=${unit.residentPopulation}, managed=${unit.localManagedPopulation}`);
          updatedCount++;
        } else {
          console.log(`Skipped "${unit.unitName}" (already matching)`);
        }
      } else {
        console.warn(`Warning: Target data not found for unit "${unit.unitName}"`);
      }
    }

    console.log(`\nSuccessfully updated ${updatedCount}/${units.length} units.`);
    process.exit(0);
  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }
}

run();
