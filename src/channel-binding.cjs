'use strict';
const {Onboarding}=require('./onboarding.cjs');
class ChannelBinding {
 constructor(bridge){this.b=bridge;}
 get state(){const partnerId=this.b.state.connection?.partnerId;return {mode:'standalone-device',state:this.b.state.connection?.appId?'configured':'unbound',partnerId:partnerId||null,candidate:partnerId?{kind:'bot',id:partnerId}:null,legacyConnectionRetained:Boolean(this.b.state.connection?.appId)};}
 async select(target){await new Onboarding(this.b).associate('default',target);return this.state;}
}
module.exports={ChannelBinding};
