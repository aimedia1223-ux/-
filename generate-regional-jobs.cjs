const fs = require('fs');
const path = require('path');

const companies = ['sigma', 'alpha', 'beta', 'gamma', 'delta', 'seals', 'freer', 'cocolabo'];
const roleTypes = ['キャンペーンクルー', 'クローザー', 'ディレクター', 'イベントMC'];
const salesChannels = ['ショップ', '量販店', '商業施設', '外販（スーパーなど）'];
const carriers = ['docomo', 'au/UQmobile', 'SoftBank/Y!mobile', 'Rakuten Mobile'];
const workLocations = ['店内', '外販（複合施設など）', '外販（スーパーなど）'];

const titleTemplates = [
  '【{station}】{carrier} 臨時イベントプロモーション・接客案内スタッフ',
  '【{station}駅前】{role}募集！{carrier}ショップ獲得イベント要員',
  '【{station}近郊】高単価！{carrier}・モバイル相談会ディレクション・運営',
  '【{station}量販店】{carrier}ブース販売・クロージング特化クルー募集'
];

const descriptions = [
  '大手通信キャリアのイベントブースにて、お声がけやティッシュ配り、サービスのご案内を行うお仕事です。未経験の方も歓迎します！',
  'モバイル端末の新規契約、MNP乗り換え相談に特化した業務です。獲得スキルやクロージングに自信のある方のご応募お待ちしております。',
  'イベントスペースや店舗前のブース設営から運営、集客のマイクパフォーマンス（MC）まで幅広くお任せします。リーダーシップを発揮できる環境です。',
  '週末の来店客数増加に伴う、店頭プロモーション応援業務です。活気のある現場で、チームワークを活かして獲得目標を目指します！'
];

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateJobs(regionPrefix, stations, locations, coords, count, startId) {
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const rCompany = companies[i % companies.length];
    const rIndex = i % stations.length;
    const rStation = stations[rIndex];
    const rLocation = locations[rIndex];
    const rCoords = coords[rIndex];
    const rRole = roleTypes[i % roleTypes.length];
    const rChannel = salesChannels[i % salesChannels.length];
    const rCarrier = carriers[i % carriers.length];
    const rWorkLoc = workLocations[i % workLocations.length];
    // Random price between 9,000 and 50,000 (in 1000s or 100s, let's use 1000s for round numbers)
    const price = getRandomInt(9, 50) * 1000;
    
    let title = titleTemplates[i % titleTemplates.length]
      .replace('{station}', rStation)
      .replace('{carrier}', rCarrier)
      .replace('{role}', rRole);
      
    const desc = descriptions[i % descriptions.length];
    const isUrgent = i % 7 === 0;
    
    const month = getRandomInt(8, 12);
    const day = getRandomInt(1, 28);
    const monthStr = month.toString().padStart(2, '0');
    const dayStr = day.toString().padStart(2, '0');
    const eventDate = `2026-${monthStr}-${dayStr}`;
    
    const dlDay = Math.max(1, day - getRandomInt(1, 7));
    const dlDayStr = dlDay.toString().padStart(2, '0');
    const applicationDeadline = `2026-${monthStr}-${dlDayStr}`;

    const offsetLat = (Math.random() - 0.5) * 0.02;
    const offsetLng = (Math.random() - 0.5) * 0.02;

    jobs.push({
      id: `${regionPrefix}_${startId + i}`,
      title,
      description: desc,
      author_id: rCompany,
      price,
      location_name: rLocation,
      lat: rCoords.lat + offsetLat,
      lng: rCoords.lng + offsetLng,
      work_hours: i % 2 === 0 ? '10:00 - 19:00' : '11:00 - 20:00',
      requirements: [`__JOB_CODE__::JOB-${regionPrefix.toUpperCase()}-${1000 + i}`],
      jobCode: `JOB-${regionPrefix.toUpperCase()}-${1000 + i}`,
      role_type: rRole,
      sales_channel: rChannel,
      carrier: rCarrier,
      event_date: eventDate,
      application_deadline: applicationDeadline,
      work_location: rWorkLoc,
      is_urgent: isUrgent
    });
  }
  return jobs;
}

const nagoyaStations = ['名古屋', '栄', '大須', '金山', '千種'];
const nagoyaLocations = ['愛知県名古屋市中村区', '愛知県名古屋市中区栄', '愛知県名古屋市中区大須', '愛知県名古屋市熱田区金山', '愛知県名古屋市千種区'];
const nagoyaCoords = [
  { lat: 35.1709, lng: 136.8815 },
  { lat: 35.1699, lng: 136.9080 },
  { lat: 35.1595, lng: 136.9030 },
  { lat: 35.1432, lng: 136.9011 },
  { lat: 35.1704, lng: 136.9304 }
];

const osakaStations = ['梅田', '難波', '天王寺', '京橋', '心斎橋'];
const osakaLocations = ['大阪府大阪市北区梅田', '大阪府大阪市中央区難波', '大阪府大阪市天王寺区', '大阪府大阪市都島区', '大阪府大阪市中央区心斎橋'];
const osakaCoords = [
  { lat: 34.7024, lng: 135.4959 },
  { lat: 34.6667, lng: 135.5000 },
  { lat: 34.6473, lng: 135.5137 },
  { lat: 34.6974, lng: 135.5332 },
  { lat: 34.6749, lng: 135.5002 }
];

const shikokuStations = ['高松', '松山', '徳島', '高知'];
const shikokuLocations = ['香川県高松市', '愛媛県松山市', '徳島県徳島市', '高知県高知市'];
const shikokuCoords = [
  { lat: 34.3401, lng: 134.0526 },
  { lat: 33.8416, lng: 132.7661 },
  { lat: 34.0704, lng: 134.5548 },
  { lat: 33.5597, lng: 133.5311 }
];

const allJobs = [
  ...generateJobs('ngy', nagoyaStations, nagoyaLocations, nagoyaCoords, 100, 1),
  ...generateJobs('osk', osakaStations, osakaLocations, osakaCoords, 100, 1),
  ...generateJobs('shk', shikokuStations, shikokuLocations, shikokuCoords, 100, 1)
];

const fileContent = `export const regionalJobs = ${JSON.stringify(allJobs, null, 2)};\n`;
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'regionalJobs.ts'), fileContent);
console.log('Successfully generated src/data/regionalJobs.ts with correct coordinates');
