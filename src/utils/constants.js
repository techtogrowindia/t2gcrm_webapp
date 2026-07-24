export const EMPTY_CUSTOMER = {
  name: '',
  companyName: '',
  email: '',
  phone: '',
  address: '',
  state: '',
  country: 'India',
  pincode: '',
  gstin: '',
  retailerId: '',
  distributorId: '',
  custom: {}
};

export const EMPTY_LEAD = {
  name: '',
  companyName: '',
  email: '',
  phone: '',
  source: '',
  stage: '',
  assign: '',
  followup: '',
  requirement: '',
  notes: '',
  productCat: '',
  // Address block — mirrors EMPTY_CUSTOMER so these carry over on conversion.
  address: '',
  state: '',
  country: 'India',
  pincode: '',
  gstin: '',
  // Linked product from the Products catalog (one per lead). productName is
  // denormalized for display/reports; productId is the real link.
  productId: '',
  productName: '',
  remWA: false,
  remEmail: true,
  remSMS: false,
  retailerId: '',
  distributorId: '',
  custom: {}
};

export const EMPTY_MEMBER = {
  name: '',
  email: '',
  phone: '',
  role: 'Sales',
  active: true
};
