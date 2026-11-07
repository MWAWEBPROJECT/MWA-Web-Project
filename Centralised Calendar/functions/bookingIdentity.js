// Only server-verified, non-anonymous identities skip a second contact challenge.
function authenticatedBookingIdentity(auth) {
 const token=auth?.token;
 return !!auth?.uid && !!token && token.firebase?.sign_in_provider!=='anonymous' &&
   (token.email_verified===true || (token.firebase?.sign_in_provider==='phone' && typeof token.phone_number==='string'));
}
module.exports={authenticatedBookingIdentity};
