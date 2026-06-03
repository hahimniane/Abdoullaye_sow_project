const apiKey = process.env.FIREBASE_API_KEY;
const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
const projectId = 'car-selling-flutter-app';
const defaultBusinessId = 'keren_auto_sales';
const defaultBusinessName = 'Keren';

if (!apiKey || !email || !password) {
  console.error('Missing FIREBASE_API_KEY, SEED_EMAIL, or SEED_PASSWORD.');
  process.exit(1);
}

const now = new Date().toISOString();

async function firebaseFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

function stringValue(value) {
  return { stringValue: value };
}

function boolValue(value) {
  return { booleanValue: value };
}

function doubleValue(value) {
  return { doubleValue: value };
}

function arrayOfStrings(values) {
  return {
    arrayValue: {
      values: values.map((value) => stringValue(value)),
    },
  };
}

function timestampValue(value) {
  return { timestampValue: value };
}

function carFields(car, business) {
  return {
    id: stringValue(car.id),
    businessId: stringValue(business.id),
    businessName: stringValue(business.name),
    businessStatus: stringValue(business.status),
    businessProfileImageUrl: stringValue(business.profileImageUrl),
    enabledServices: arrayOfStrings(business.enabledServices),
    title: stringValue(car.title),
    make: stringValue(car.make),
    model: stringValue(car.model),
    year: stringValue(car.year),
    mileage: stringValue(car.mileage),
    price: doubleValue(car.price),
    description: stringValue(car.description),
    features: arrayOfStrings(car.features),
    structuredFeatures: arrayOfStrings(car.structuredFeatures),
    imageUrls: arrayOfStrings(car.imageUrls),
    status: stringValue('active'),
    contactPhone: stringValue(car.contactPhone),
    contactName: stringValue(car.contactName),
    contactEmail: stringValue(car.contactEmail),
    condition: stringValue(car.condition),
    bodyType: stringValue(car.bodyType),
    transmission: stringValue(car.transmission),
    fuelType: stringValue(car.fuelType),
    drivetrain: stringValue(car.drivetrain),
    exteriorColor: stringValue(car.exteriorColor),
    interiorColor: stringValue(car.interiorColor),
    vin: stringValue(car.vin),
    stockNumber: stringValue(car.stockNumber),
    isNegotiable: boolValue(car.isNegotiable),
    financingNote: stringValue(car.financingNote),
    locationAddressLine1: stringValue(car.locationAddressLine1),
    locationCity: stringValue(car.locationCity),
    locationState: stringValue(car.locationState),
    locationPostalCode: stringValue(car.locationPostalCode),
    useBusinessHoldPricing: boolValue(true),
    carHoldPricingMode: stringValue(''),
    createdAt: timestampValue(now),
    updatedAt: timestampValue(now),
  };
}

async function signIn() {
  return firebaseFetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
}

async function getDocument(path, idToken) {
  return firebaseFetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
}

async function patchDocument(path, idToken, fields) {
  return firebaseFetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    },
  );
}

function readString(fields, key, fallback = '') {
  return fields?.[key]?.stringValue ?? fallback;
}

function readStringArray(fields, key, fallback = []) {
  return fields?.[key]?.arrayValue?.values?.map((item) => item.stringValue).filter(Boolean) ?? fallback;
}

const cars = [
  {
    id: 'codex_2021_toyota_camry_se',
    title: '2021 Toyota Camry SE',
    make: 'Toyota',
    model: 'Camry',
    year: '2021',
    mileage: '38,420',
    price: 22950,
    description: 'Clean midsize sedan with a smooth ride, strong fuel economy, and a well-kept black interior.',
    features: ['Backup camera', 'Apple CarPlay', 'Lane assist', 'Bluetooth', 'Alloy wheels'],
    structuredFeatures: ['backup_camera', 'apple_carplay', 'bluetooth'],
    imageUrls: [
      'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1623869675781-80aa31012a5a?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1624951352908-3579b7df9c05?auto=format&fit=crop&w=1400&q=85',
    ],
    contactPhone: '+17185550124',
    contactName: 'Keren Auto Sales',
    contactEmail: 'sales@kerenauto.example',
    condition: 'excellent',
    bodyType: 'sedan',
    transmission: 'automatic',
    fuelType: 'gas',
    drivetrain: 'fwd',
    exteriorColor: 'White',
    interiorColor: 'Black',
    vin: '4T1G11AK9MU412345',
    stockNumber: 'KAS-2021-CAMRY',
    isNegotiable: true,
    financingNote: 'Financing options available for qualified buyers.',
    locationAddressLine1: '123 Boston Road',
    locationCity: 'Bronx',
    locationState: 'NY',
    locationPostalCode: '10456',
  },
  {
    id: 'codex_2020_honda_crv_ex',
    title: '2020 Honda CR-V EX AWD',
    make: 'Honda',
    model: 'CR-V',
    year: '2020',
    mileage: '52,180',
    price: 24750,
    description: 'Practical AWD SUV with roomy cargo space, safety tech, and a comfortable cabin for family driving.',
    features: ['AWD', 'Sunroof', 'Blind spot monitor', 'Heated seats', 'Remote start'],
    structuredFeatures: ['awd', 'sunroof', 'heated_seats'],
    imageUrls: [
      'https://images.unsplash.com/photo-1564084359014-37225d403f06?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1564084372010-3f5f8c6c095a?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1623597780975-38ccd5030c83?auto=format&fit=crop&w=1400&q=85',
    ],
    contactPhone: '+17185550124',
    contactName: 'Keren Auto Sales',
    contactEmail: 'sales@kerenauto.example',
    condition: 'good',
    bodyType: 'suv',
    transmission: 'cvt',
    fuelType: 'gas',
    drivetrain: 'awd',
    exteriorColor: 'Gray',
    interiorColor: 'Charcoal',
    vin: '7FARW2H59LE012345',
    stockNumber: 'KAS-2020-CRV',
    isNegotiable: true,
    financingNote: 'Ask about extended hold and financing options.',
    locationAddressLine1: '123 Boston Road',
    locationCity: 'Bronx',
    locationState: 'NY',
    locationPostalCode: '10456',
  },
  {
    id: 'codex_2019_bmw_330i',
    title: '2019 BMW 330i xDrive',
    make: 'BMW',
    model: '330i',
    year: '2019',
    mileage: '46,900',
    price: 26900,
    description: 'Sport sedan with xDrive, premium interior touches, responsive handling, and a sharp exterior finish.',
    features: ['xDrive AWD', 'Navigation', 'Leather seats', 'Parking sensors', 'Premium audio'],
    structuredFeatures: ['awd', 'navigation', 'leather_seats'],
    imageUrls: [
      'https://images.unsplash.com/photo-1524102724373-bcf6ed410592?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1534791108293-e080c7d856e7?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1585225278816-1f33dc1be8eb?auto=format&fit=crop&w=1400&q=85',
    ],
    contactPhone: '+17185550124',
    contactName: 'Keren Auto Sales',
    contactEmail: 'sales@kerenauto.example',
    condition: 'excellent',
    bodyType: 'sedan',
    transmission: 'automatic',
    fuelType: 'gas',
    drivetrain: 'awd',
    exteriorColor: 'Blue',
    interiorColor: 'Tan',
    vin: 'WBA5R7C53KA012345',
    stockNumber: 'KAS-2019-330I',
    isNegotiable: false,
    financingNote: 'Premium listing. Trade-ins considered.',
    locationAddressLine1: '123 Boston Road',
    locationCity: 'Bronx',
    locationState: 'NY',
    locationPostalCode: '10456',
  },
];

const auth = await signIn();
const userDoc = await getDocument(`users/${auth.localId}`, auth.idToken);
const userFields = userDoc.fields ?? {};
const role = readString(userFields, 'role');
const businessId = role === 'admin'
  ? defaultBusinessId
  : readString(userFields, 'businessId', defaultBusinessId);

const businessDoc = await getDocument(`businesses/${businessId}`, auth.idToken);
const businessFields = businessDoc.fields ?? {};
const business = {
  id: businessId,
  name: readString(businessFields, 'name', defaultBusinessName),
  status: readString(businessFields, 'status', 'approved'),
  profileImageUrl: readString(businessFields, 'profileImageUrl', ''),
  enabledServices: readStringArray(businessFields, 'enabledServices', ['carSales', 'parking', 'barrelShipping', 'transport']),
};

for (const car of cars) {
  await patchDocument(`cars/${car.id}`, auth.idToken, carFields(car, business));
  console.log(`Upserted ${car.title} (${car.id})`);
}

console.log(`Done. Signed in as ${email}; role=${role || 'unknown'}; business=${business.id}.`);
