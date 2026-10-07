'use strict';
window.AdminData = {
  menus: {
    store: [
      ['orders','预约与派单','calendar-days','业务管理'],['aftersales','售后处理','messages-square'],['schedule','技师与排班','users'],['reviews','投诉与评价','message-square-text'],
      ['finance','对账与提成','receipt','财务管理'],['invoices','发票管理','files'],['promotion','门店推广','qr-code','门店管理'],['rules','门店规则','sliders-horizontal'],['settings','门店设置','store'],['safety','安全值班','shield-check']
    ],
    hq: [
      ['catalog','项目与价格','layers','运营管理'],['stores','门店管理','store'],['technicians','技师档案','users-round'],['rules','规则配置','sliders-horizontal'],
      ['sharing','分账监控','split','财务管理'],['recovery','追偿台账','notebook-tabs'],['withdrawals','佣金与提现','wallet'],
      ['aftersales','售后与客服','headset','服务管理'],['reviews','投诉与评价','message-square-text'],['users','用户管理','contact-round'],['safety','安全中心','shield-check'],
      ['promotion','分销管理','network','集团管理'],['analytics','数据看板','chart-no-axes-combined'],['accounts','账号与权限','key-round']
    ]
  },
  seed() {
    const t = value => Date.parse('2026-10-02T'+value+':00+08:00');
    const past = value => Date.parse(value+'+08:00');
    const order = (id,store,customer,tech,item,start,status,paid,extra={}) => {const o={id,store,customer,phone:'138****'+id,tech,item,start:t(start),status,paid,refund:0,refundPending:0,round:1,paidAt:t('09:20'),roundStart:t('09:20'),deadline:t('09:50'),mode:'nearby',completedAt:null,startedAt:null,departed:false,proposal:null,...extra};o.logs=[{at:o.paidAt,text:paid?'付款成功，建立预约记录':'付款超时，预约已关闭',actor:'系统'}];if(o.startedAt)o.logs.unshift({at:o.startedAt,text:'实际开始服务',actor:'技师'});if(o.completedAt)o.logs.unshift({at:o.completedAt,text:'实际完成服务',actor:'技师'});return o;};
    return {
      schema:1,now:t('09:40'),session:null,
      stores:[
        {id:'s1',name:'幸福里门店',district:'鼓楼区',address:'中山北路128号',type:'直营',status:'营业中',techs:4,merchant:'1900****2186',authorized:true,open:'09:00–23:00',radius:5},
        {id:'s2',name:'河西门店',district:'建邺区',address:'江东中路168号',type:'加盟',status:'营业中',techs:2,merchant:'1900****5073',authorized:true,open:'09:00–23:00',radius:5},
        {id:'s3',name:'江宁门店',district:'江宁区',address:'双龙大道88号',type:'加盟',status:'待上线审核',techs:1,merchant:'1900****6532',authorized:true,open:'09:00–23:00',radius:4}
      ],
      techs:[
        {id:'t1',name:'林师傅',store:'s1',gender:'男',skills:['full','neck'],status:'在岗',insurance:'2027-09-30',rating:'4.9',orders:126,shift:'09:00–23:00'},
        {id:'t2',name:'陈师傅',store:'s1',gender:'女',skills:['full','neck'],status:'在岗',insurance:'2027-08-15',rating:'4.8',orders:88,shift:'09:00–23:00'},
        {id:'t3',name:'周师傅',store:'s1',gender:'男',skills:['full'],status:'在岗',insurance:'2027-07-20',rating:'新技师',orders:3,shift:'09:00–23:00'},
        {id:'t4',name:'赵师傅',store:'s1',gender:'女',skills:['full','neck'],status:'请假',insurance:'2027-06-12',rating:'4.9',orders:96,shift:'请假'},
        {id:'t5',name:'杨师傅',store:'s2',gender:'女',skills:['full','neck'],status:'在岗',insurance:'2027-08-12',rating:'4.9',orders:75,shift:'09:00–23:00'},
        {id:'t6',name:'吴师傅',store:'s3',gender:'女',skills:['full','neck'],status:'资料审核',insurance:'2027-09-30',rating:'新技师',orders:0,shift:'待审核'}
      ],
      items:[{id:'full',name:'舒缓放松',duration:60,price:29800,night:29800,overtime:14900,status:'已上架',description:'全身舒缓，缓解日常疲劳。'},{id:'neck',name:'肩颈舒缓',duration:45,price:19800,night:22800,overtime:13200,status:'已上架',description:'肩颈舒缓，适合久坐人群。'}],
      orders:[
        order('1001','s1','王女士','t1','full','12:00','待分配',29800,{mode:'specified',note:'希望安排原预约技师；如需更换，请先确认。'}),
        order('1002','s1','李先生','t1','neck','14:00','已确认',19800,{mode:'nearby',note:'肩颈项目，下午有空。'}),
        order('1003','s1','刘女士','t1','full','09:00','进行中',29800,{paidAt:past('2026-10-01T18:00:00'),roundStart:past('2026-10-01T18:00:00'),deadline:past('2026-10-01T18:30:00'),startedAt:t('09:00'),departed:true,note:'已开始预约。'}),
        order('1004','s1','张女士','t2','full','16:00','已完成',44700,{start:past('2026-10-01T16:00:00'),paidAt:past('2026-10-01T12:00:00'),roundStart:past('2026-10-01T12:00:00'),deadline:past('2026-10-01T12:30:00'),completedAt:past('2026-10-01T17:30:00'),startedAt:past('2026-10-01T16:00:00'),extraMinutes:30,payments:[{id:'p1004',name:'主单支付',paid:29800,refunded:0,request:9800},{id:'p1004a',name:'加时支付 · 30分钟',paid:14900,refunded:0,request:4900}],sharing:'待结算'}),
        order('1005','s1','陈先生','t2','neck','16:00','已确认',19800,{mode:'specified',note:'已预约陈师傅。'}),
        order('1006','s1','赵女士','t3','full','18:00','已取消',29800,{refund:29800,sharing:'无需分账'}),
        order('1007','s2','吴女士','t5','neck','13:00','待分配',19800,{deadline:t('10:00'),paidAt:t('09:30'),roundStart:t('09:30')}),
        order('1008','s1','孙先生','t2','full','14:00','已完成',29800,{start:past('2026-09-29T14:00:00'),paidAt:past('2026-09-29T10:00:00'),roundStart:past('2026-09-29T10:00:00'),deadline:past('2026-09-29T10:30:00'),startedAt:past('2026-09-29T14:00:00'),completedAt:past('2026-09-29T15:00:00'),sharing:'分账失败'}),
        order('1009','s1','周女士','t2','neck','20:00','已关闭',0,{note:'15分钟内未支付，时段已释放。'})
      ],
      cases:[{id:'AS1001',order:'1004',type:'时长与体验',status:'待门店处理',reason:'希望主单退98元，加时退49元，合计147元。',deadline:t('23:59'),plan:null,logs:[]}],
      leaves:[{id:'L1001',tech:'t1',store:'s1',type:'紧急请假',start:t('13:00'),end:t('18:00'),reason:'临时身体不适，申请下午休息。',status:'待审批'},{id:'L1002',tech:'t2',store:'s1',type:'普通请假',start:t('16:00'),end:t('18:00'),reason:'个人事务，已有预约需先协调。',status:'待审批'}],
      invoices:[{id:'FP1001',order:'1008',store:'s1',title:'南京青禾科技有限公司',tax:'913201**********3X',email:'finance@example.com',status:'待开票',amount:29800,file:null},{id:'FP1002',order:'1004',store:'s1',title:'张女士（个人）',tax:'—',email:'zhang@example.com',status:'已开票',amount:44700,file:'示例发票-1004.pdf'}],
      safety:[{id:'SOS1001',order:'1003',store:'s1',status:'待接报',reason:'服务对象反馈身体不适，请联系双方核实。',created:t('09:39'),handler:'待接报',unresolved:true,result:'',logs:[]}],
      reviews:[{id:'RV1001',order:'1008',store:'s1',tech:'t2',score:2,content:'沟通不够及时，希望能提前说明。',status:'申诉初审',appeal:'当天已提前联系用户，申请补充核实。',result:''},{id:'RV1002',order:'1004',store:'s1',tech:'t2',score:5,content:'手法舒适，沟通耐心。',status:'显示中',appeal:'',result:''}],
      recoveries:[{id:'RC1001',order:'历史预约 TL2609270980',store:'s1',type:'分账回退失败',amount:1470,returned:0,status:'待处理',reason:'历史预约的分账回退失败，渠道提示余额不足。'}],
      withdrawals:[{id:'TX1001',name:'林师傅',store:'s1',amount:10000,status:'处理中',count:2},{id:'TX1002',name:'王推广员',store:'s2',amount:18640,status:'失败待处理',count:3}],
      promoters:[{id:'PR1001',name:'林师傅',store:'s1',type:'技师',customers:18,commission:18640,status:'有效'},{id:'PR1002',name:'王推广员',store:'s2',type:'门店推广员',customers:26,commission:26480,status:'有效'}],
      users:[{id:'U1001',name:'王女士',phone:'138****1001',orders:3,status:'正常',reason:''},{id:'U1002',name:'李先生',phone:'138****1002',orders:2,status:'待限制审核',reason:'30天内两次爽约，门店提出限制30天。'}],
      accounts:[{id:'A01',name:'何店长',scope:'幸福里门店',role:'店长',status:'启用'},{id:'A02',name:'徐会计',scope:'幸福里门店',role:'门店财务',status:'启用'},{id:'A03',name:'周运营',scope:'集团',role:'集团运营',status:'启用'},{id:'A04',name:'赵客服',scope:'集团',role:'集团客服',status:'启用'}],
      rules:{hqRate:15,storeRate:5,commission:10,techRate:40,compensation:50,radius:5,buffer:30,payMinutes:15,dispatchMinutes:30,earliestHours:2,afterHours:48,maxDays:7,version:1},
      audit:[],messages:[],paidTech:[],techPayouts:[],duty:'何店长 / 赵客服',exportCount:0
    };
  }
};
