const donationFunds={
 'donate-niaz':'Niaz Contribution','donate-general':'General Donation','donate-313':'313 Contribution',
 'donate-youth':'Youth Fund','donate-khums':'Khums Contribution','donate-school':'Donation for MWA School','donate-fitra':'Fitra'
};
const enquiries={
 contact:'General enquiry',membership:'Membership',school:'Saturday School',tutoring:'Tutoring',
 volunteer:'Volunteering',counselling:'Counselling',support:'Community support',
 cemetery:'Cemetery services',aalim:'Resident Aalim'
};
export function publicAction(id){
 if(id==='book')return {kind:'booking',label:'Complete a public booking with Khadim'};
 if(id==='niaz')return {kind:'niaz',label:'Submit a Niaz offer with Khadim'};
 if(id==='forms')return {kind:'registration',label:'Complete a registration with Khadim'};
 if(id==='appearance')return {kind:'appearance',label:'Adjust appearance with Khadim'};
 if(id==='donate'||id==='recurring-donation'||donationFunds[id])return {kind:'donation',fund:donationFunds[id]||'',mode:id==='recurring-donation'?'recurring_only':'one_off',label:'Prepare a donation with Khadim'};
 if(enquiries[id])return {kind:'contact',topic:enquiries[id],label:'Send an enquiry with Khadim'};
 return null;
}
