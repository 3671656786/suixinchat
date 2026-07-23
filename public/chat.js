let socket, currentUser, replyToMsg = null;
let historyLoaded = false, isLoadingMore = false, hasMoreHistory = true, oldestMessageId = null;
const PAGE_SIZE = 20;
let currentPrivateTarget = null, unreadCounts = {};
let currentGroupId = 0, myGroups = [];
const D = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';

const $ = id => document.getElementById(id);
const messagesArea = $('messagesArea'), messageInput = $('messageInput'), sendBtn = $('sendBtn');
const fileBtn = $('fileBtn'), fileInput = $('fileInput'), onlineList = $('onlineList'), onlineCount = $('onlineCount');
const emojiBtn = $('emojiBtn'), emojiPanel = $('emojiPanel'), replyBar = $('replyBar'), replyContent = $('replyContent');
const cancelReplyBtn = $('cancelReplyBtn'), searchBtn = $('searchBtn'), searchModal = $('searchModal');
const privateChatWindow = $('privateChatWindow'), privateMessagesArea = $('privateMessagesArea');
const privateInput = $('privateInput'), sendPrivateBtn = $('sendPrivateBtn'), privateChatListBtn = $('privateChatListBtn');
const currentChatTitle = $('currentChatTitle'), groupList = $('groupList');
const createGroupBtn = $('createGroupBtn'), discoverGroupsBtn = $('discoverGroupsBtn'), groupMembersBtn = $('groupMembersBtn');
const createGroupModal = $('createGroupModal'), discoverGroupsModal = $('discoverGroupsModal'), groupMembersModal = $('groupMembersModal');

function esc(t){if(!t)return'';var e={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};return t.replace(/[&<>"']/g,function(m){return e[m]})}
function ft(ts){const d=new Date(ts),n=new Date(),df=n-d;if(df<6e4)return'刚刚';if(df<36e5)return Math.floor(df/6e4)+'分钟前';if(df<864e5)return Math.floor(df/36e5)+'小时前';return d.toLocaleDateString()}
function debounce(f,w){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f(...a),w)}}
function inView(el){const r=el.getBoundingClientRect(),cr=messagesArea.getBoundingClientRect();return r.top>=cr.top&&r.bottom<=cr.bottom}
function sendReads(){[...document.querySelectorAll('.message')].filter(m=>inView(m)).map(m=>m.dataset.id).filter(Boolean).forEach(i=>socket&&socket.emit('mark messages read',[i]))}
messagesArea.addEventListener('scroll', debounce(sendReads,500));

function sysMsg(t){const d=document.createElement('div');d.className='system-message';d.innerHTML=t;messagesArea.appendChild(d);messagesArea.scrollTop=messagesArea.scrollHeight}

function appendMessage(msg,prepend){
  const d=document.createElement('div');
  d.className=`message ${currentUser&&msg.userId===currentUser.userId?'message-right':'message-left'}`;
  d.dataset.id=msg.id;
  const a=document.createElement('img');a.src=msg.avatarUrl||D;a.className='message-avatar';a.onerror=()=>a.src=D;
  const b=document.createElement('div');b.className='message-bubble';
  if(currentUser&&msg.userId!==currentUser.userId){const n=document.createElement('div');n.className='message-name';n.innerText=msg.username;b.appendChild(n)}
  if(msg.replyTo||(msg.replyToUsername&&msg.replyToContent)){
    const rd=document.createElement('div');rd.style.cssText='font-size:12px;color:#999;margin-bottom:4px;padding:4px 8px;background:#f0f0f0;border-radius:8px;';
    rd.innerHTML=`<span style="color:var(--primary);">${esc(msg.replyTo?msg.replyTo.username:msg.replyToUsername)}</span>: ${esc((msg.replyTo?msg.replyTo.content:msg.replyToContent||'').substring(0,50))}`;b.appendChild(rd)
  }
  if(msg.content){const t=document.createElement('div');t.className='message-text';t.innerHTML=esc(msg.content);b.appendChild(t)}
  if(msg.fileUrl){
    const fd=document.createElement('div');fd.className='file-message';const fn=msg.fileName||'文件',ftype=msg.fileType||'',pa=document.createElement('div');
    if(ftype.startsWith('image/')){const img=document.createElement('img');img.src=msg.fileUrl;img.style.cssText='max-width:200px;max-height:150px;border-radius:8px;cursor:pointer';img.onclick=()=>window.open(msg.fileUrl,'_blank');pa.appendChild(img)}
    else if(ftype.startsWith('video/')){const v=document.createElement('video');v.src=msg.fileUrl;v.controls=true;v.style.cssText='max-width:200px;max-height:150px';pa.appendChild(v)}
    else{const l=document.createElement('a');l.href=msg.fileUrl;l.textContent='📄 预览';l.target='_blank';l.style.cssText='display:inline-block;margin:4px 0';pa.appendChild(l)}
    fd.appendChild(pa);const ad=document.createElement('div');ad.className='file-actions';
    const ns=document.createElement('span');ns.innerText=fn;ns.style.cssText='font-size:12px;color:#666;margin-right:8px';ad.appendChild(ns);
    const pb=document.createElement('button');pb.textContent='预览';pb.onclick=e=>{e.stopPropagation();window.open(msg.fileUrl,'_blank');};
    const db=document.createElement('button');db.textContent='下载';db.onclick=e=>{e.stopPropagation();const a2=document.createElement('a');a2.href=msg.fileUrl;a2.download=fn;document.body.appendChild(a2);a2.click();document.body.removeChild(a2);};
    ad.appendChild(pb);ad.appendChild(db);fd.appendChild(ad);b.appendChild(fd)
  }
  const ts=document.createElement('div');ts.className='message-time';ts.innerText=ft(msg.timestamp);b.appendChild(ts);
  if(currentUser&&(currentUser.userId===msg.userId||currentUser.role==='admin')){
    const rb=document.createElement('button');rb.innerText='撤回';rb.className='recall-btn';
    rb.onclick=e=>{e.stopPropagation();currentGroupId===0?socket.emit('recall message',msg.id):socket.emit('recall group message',{groupId:currentGroupId,messageId:msg.id})};
    b.appendChild(rb)
  }
  b.style.cursor='pointer';b.onclick=()=>{if(msg.content){replyToMsg={id:msg.id,username:msg.username,content:msg.content};replyContent.innerText='回复 '+msg.username+': '+msg.content.substring(0,50);replyBar.classList.remove('hidden')}};
  d.appendChild(a);d.appendChild(b);
  if(prepend){const ld=$('loadingMore');if(ld)messagesArea.insertBefore(d,ld.nextSibling);else messagesArea.prepend(d)}
  else{messagesArea.appendChild(d);messagesArea.scrollTop=messagesArea.scrollHeight}
}

function renderMessages(msgs){messagesArea.innerHTML='<div id="loadingMore">⏳ 加载更早消息...</div>';msgs.forEach(m=>appendMessage(m));const ld=$('loadingMore');if(ld)ld.style.display='none'}

async function loadMore(){
  if(isLoadingMore||!hasMoreHistory)return;const fm=document.querySelector('.message');if(!fm){hasMoreHistory=false;return}
  oldestMessageId=fm.dataset.id;if(!oldestMessageId)return;isLoadingMore=true;const ld=$('loadingMore');if(ld)ld.style.display='block';
  try{
    const url=currentGroupId===0?`/api/messages?limit=${PAGE_SIZE}&before=${oldestMessageId}`:`/api/groups/${currentGroupId}/messages?limit=${PAGE_SIZE}&before=${oldestMessageId}`;
    const r=await fetch(url,{credentials:'include'});const d=await r.json();
    if(d.success&&d.messages?.length){const oH=messagesArea.scrollHeight,oT=messagesArea.scrollTop;d.messages.reverse().forEach(m=>appendMessage(m,true));messagesArea.scrollTop=oT+(messagesArea.scrollHeight-oH);const nf=document.querySelector('.message');if(nf)oldestMessageId=nf.dataset.id;hasMoreHistory=d.messages.length===PAGE_SIZE}else hasMoreHistory=false
  }catch(e){console.error(e)}finally{isLoadingMore=false;if(ld)ld.style.display='none'}
}
messagesArea.addEventListener('scroll',()=>{if(messagesArea.scrollTop===0&&!isLoadingMore&&hasMoreHistory)loadMore()});

async function loadHistory(){
  try{
    const url=currentGroupId===0?'/api/messages?limit=50':`/api/groups/${currentGroupId}/messages?limit=50`;
    const r=await fetch(url,{credentials:'include'});const d=await r.json();
    if(d.success&&d.messages){renderMessages(d.messages);historyLoaded=true;hasMoreHistory=d.messages.length===50;sendReads()}
  }catch(e){console.error(e)}
}

function sendMsg(){let c=messageInput.value.trim();if(!c&&!replyToMsg)return;if(currentGroupId===0)socket.emit('chat message',c,replyToMsg?.id||null);else socket.emit('group message',{groupId:currentGroupId,content:c,replyToId:replyToMsg?.id||null});messageInput.value='';if(replyToMsg){replyToMsg=null;replyBar.classList.add('hidden')}messageInput.focus()}
sendBtn.onclick=sendMsg;messageInput.onkeypress=e=>{if(e.key==='Enter')sendMsg()};cancelReplyBtn.onclick=()=>{replyToMsg=null;replyBar.classList.add('hidden')};

async function sendFile(f){
  const fd=new FormData();fd.append('file',f);
  try{const r=await fetch('/api/upload',{method:'POST',credentials:'include',body:fd});const d=await r.json();if(d.success){if(currentGroupId===0)socket.emit('file message',{fileUrl:d.fileUrl,fileName:d.fileName,fileType:d.fileType});else socket.emit('group file message',{groupId:currentGroupId,fileUrl:d.fileUrl,fileName:d.fileName,fileType:d.fileType})}else alert('上传失败: '+d.message)}catch(e){alert('上传失败')}
}
fileBtn.onclick=()=>fileInput.click();fileInput.onchange=e=>{if(e.target.files[0])sendFile(e.target.files[0]);fileInput.value=''};

const emojis=['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];
function buildEmoji(){emojiPanel.innerHTML='';emojis.forEach(e=>{const s=document.createElement('span');s.innerText=e;s.onclick=()=>{messageInput.value+=e;messageInput.focus();emojiPanel.style.display='none'};emojiPanel.appendChild(s)})}
buildEmoji();emojiBtn.onclick=e=>{e.stopPropagation();emojiPanel.style.display=emojiPanel.style.display==='flex'?'none':'flex'};document.onclick=e=>{if(!emojiPanel.contains(e.target)&&e.target!==emojiBtn)emojiPanel.style.display='none'};

searchBtn.onclick=()=>{searchModal.style.display='flex';$('searchKeyword').value='';$('searchUsername').value='';$('searchStartDate').value='';$('searchEndDate').value='';$('searchResults').innerHTML=''};
$('closeSearchModalBtn').onclick=()=>searchModal.style.display='none';
async function locate(mId){let tm=document.querySelector(`.message[data-id="${mId}"]`);if(tm){tm.scrollIntoView({behavior:'smooth'});tm.style.backgroundColor='#ffffcc';setTimeout(()=>tm.style.backgroundColor='',2000);return true}while(!tm&&hasMoreHistory&&!isLoadingMore){await loadMore();tm=document.querySelector(`.message[data-id="${mId}"]`);if(tm){tm.scrollIntoView({behavior:'smooth'});tm.style.backgroundColor='#ffffcc';setTimeout(()=>tm.style.backgroundColor='',2000);return true}await new Promise(r=>setTimeout(r,300))}alert('未找到');return false}
$('doSearchBtn').onclick=async()=>{const kw=$('searchKeyword').value.trim(),un=$('searchUsername').value.trim(),sd=$('searchStartDate').value,ed=$('searchEndDate').value,ty=$('searchType').value;const p=new URLSearchParams();if(kw)p.append('keyword',kw);if(un)p.append('username',un);if(sd)p.append('startDate',sd);if(ed)p.append('endDate',ed);if(ty)p.append('type',ty);try{const r=await fetch('/api/search?'+p.toString(),{credentials:'include'});const d=await r.json();if(d.success){$('searchResults').innerHTML='';if(!d.results.length){$('searchResults').innerHTML='<div class="system-message">无结果</div>';return}d.results.forEach(m=>{const dv=document.createElement('div');dv.className='search-result-item';dv.innerHTML=`<strong>${esc(m.username)}</strong> ${new Date(m.timestamp).toLocaleString()}<br>${esc(m.content||'[文件]')}`;dv.onclick=()=>{locate(m.id);searchModal.style.display='none'};$('searchResults').appendChild(dv)})}}catch(e){alert('搜索失败')}};

// 私聊
function updBadge(uid,c){const ud=document.querySelector(`.online-user[data-userid="${uid}"]`);if(ud){let b=ud.querySelector('.unread-badge');if(c>0){if(!b){b=document.createElement('span');b.className='unread-badge';ud.appendChild(b)}b.innerText=c>99?'99+':c}else if(b)b.remove()}}
function appendPM(msg,sent){
  const d=document.createElement('div');d.className=`private-message ${sent?'private-message-sent':'private-message-received'}`;
  d.innerHTML=`<div style="font-size:11px;${sent?'color:#e0e0e0':'color:#999'}">${sent?'我':esc(msg.username||'对方')}</div><div>${esc(msg.content)}</div><div style="font-size:10px;text-align:right;${sent?'color:#e0e0e0':'color:#999'}">${ft(msg.timestamp)}</div>`;
  privateMessagesArea.appendChild(d);privateMessagesArea.scrollTop=privateMessagesArea.scrollHeight
}
async function openPChat(tid,tun){currentPrivateTarget={id:tid,username:tun};privateChatWindow.style.display='flex';$('privateChatHeader').innerHTML=`<span>💬 与 ${esc(tun)} 私聊</span><button id="closePChatBtn" style="background:none;border:none;color:white;cursor:pointer;">✕</button>`;$('closePChatBtn').onclick=()=>{privateChatWindow.style.display='none';currentPrivateTarget=null};privateMessagesArea.innerHTML='';const r=await fetch('/api/private/messages/'+tid,{credentials:'include'});const d=await r.json();if(d.success)d.messages.forEach(m=>{const s=m.from_user===currentUser.userId;appendPM({...m,username:s?null:tun},s)});socket.emit('join private room',tid);socket.emit('mark private read',tid);unreadCounts[tid]=0;updBadge(tid,0)}
function renderOnline(us){onlineList.innerHTML='';onlineCount.innerText=us.length;us.forEach(u=>{if(u.userId===currentUser.userId)return;const d=document.createElement('div');d.className='online-user';d.dataset.userid=u.userId;const si=u.status==='chat'?'💬':u.status==='files'?'📁':'📝';const av = u.avatarUrl||D;d.innerHTML=`<div class="online-user-info"><img src="${esc(av)}"><span>${esc(u.username)} ${si}</span></div>`;const uc=unreadCounts[u.userId]||0;if(uc>0){const b=document.createElement('span');b.className='unread-badge';b.innerText=uc>99?'99+':uc;d.appendChild(b)}d.onclick=()=>openPChat(u.userId,u.username);onlineList.appendChild(d)})}
privateChatListBtn.onclick=()=>{const m=document.createElement('div');m.className='modal';m.style.display='flex';m.innerHTML=`<div class="modal-content"><h3>私聊列表</h3><div id="pcl" style="max-height:300px;overflow-y:auto;"></div><button id="cpclb" style="margin-top:12px;width:100%;padding:8px;border-radius:20px;border:none;cursor:pointer;">关闭</button></div>`;document.body.appendChild(m);fetch('/api/private/list',{credentials:'include'}).then(r=>r.json()).then(d=>{if(!d.success)return;const c=m.querySelector('#pcl');c.innerHTML='';if(!d.chats.length){c.innerHTML='<div style="text-align:center;color:#999;padding:20px;">暂无</div>';return}d.chats.forEach(ch=>{const dv=document.createElement('div');dv.className='online-user';dv.style.cssText='cursor:pointer;justify-content:space-between';const av = ch.avatarUrl||D;dv.innerHTML=`<div class="online-user-info"><img src="${esc(av)}"><span>${esc(ch.username)}</span></div>${ch.unread>0?'<span class="unread-badge">'+ch.unread+'</span>':''}`;dv.onclick=()=>{openPChat(ch.userId,ch.username);m.remove()};c.appendChild(dv)})});m.querySelector('#cpclb').onclick=()=>m.remove()};
sendPrivateBtn.onclick=()=>{if(!currentPrivateTarget||!privateInput.value.trim())return;const c=privateInput.value.trim();socket.emit('private message',{toUserId:currentPrivateTarget.id,content:c});appendPM({content:c,timestamp:new Date().toISOString()},true);privateInput.value=''};
privateInput.onkeypress=e=>{if(e.key==='Enter')sendPrivateBtn.click()};

// 群聊
function switchGroup(gid,name){
  if(gid===currentGroupId)return;
  if(currentGroupId===0)socket.emit('leave chat');else socket.emit('leave group room',currentGroupId);
  currentGroupId=gid;historyLoaded=false;hasMoreHistory=true;oldestMessageId=null;
  currentChatTitle.textContent=name;
  document.querySelectorAll('.group-item').forEach(el=>el.classList.remove('active'));
  const ti=document.querySelector(`.group-item[data-group-id="${gid}"]`);if(ti)ti.classList.add('active');
  groupMembersBtn.style.display=gid===0?'none':'inline-block';
  messagesArea.innerHTML='<div id="loadingMore">⏳ 加载更早消息...</div>';
  loadHistory();
  if(gid===0){socket.emit('join chat');socket.emit('update status','chat')}else socket.emit('join group room',gid)
}

function renderGroups(gs){
  myGroups=gs;
  let html='<div class="group-item active" data-group-id="0"><span class="group-item-icon">💬</span><div class="group-item-info"><div class="group-item-name">公共聊天室</div><div class="group-item-count">默认</div></div></div>';
  gs.forEach(g=>{html+=`<div class="group-item ${g.id===currentGroupId?'active':''}" data-group-id="${g.id}" data-group-name="${esc(g.name)}"><span class="group-item-icon">👥</span><div class="group-item-info"><div class="group-item-name">${esc(g.name)}</div><div class="group-item-count">${g.memberCount}人</div></div></div>`});
  groupList.innerHTML=html;
  document.querySelectorAll('.group-item').forEach(el=>{el.onclick=()=>{const id=Number(el.dataset.groupId);id===0?switchGroup(0,'💬 公共聊天室'):switchGroup(id,'👥 '+(el.dataset.groupName||'群聊'))}})
}

async function loadGroups(){try{const r=await fetch('/api/groups',{credentials:'include'});const d=await r.json();if(d.success)renderGroups(d.groups)}catch(e){}}

createGroupBtn.onclick=()=>{createGroupModal.style.display='flex';$('newGroupName').value='';$('newGroupDesc').value='';$('newGroupName').focus()};
$('closeCreateGroupBtn').onclick=()=>createGroupModal.style.display='none';
$('doCreateGroupBtn').onclick=async()=>{const n=$('newGroupName').value.trim(),d=$('newGroupDesc').value.trim();if(!n||n.length<1||n.length>20){alert('群名称1-20字');return}try{const r=await fetch('/api/groups',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,description:d})});const dt=await r.json();if(dt.success){createGroupModal.style.display='none';switchGroup(dt.group.id,'👥 '+dt.group.name);loadGroups()}else alert(dt.message)}catch(e){alert('创建失败')}};

discoverGroupsBtn.onclick=async()=>{discoverGroupsModal.style.display='flex';const c=$('discoverGroupList');c.innerHTML='<div style="text-align:center;padding:20px;color:#999;">加载中...</div>';try{const r=await fetch('/api/groups/discover',{credentials:'include'});const d=await r.json();c.innerHTML='';if(!d.success||!d.groups.length){c.innerHTML='<div style="text-align:center;padding:20px;color:#999;">暂无其他群</div>';return}d.groups.forEach(g=>{const dv=document.createElement('div');dv.className='discover-group-item';dv.innerHTML=`<div class="gi"><h4>👥 ${esc(g.name)}</h4><p>${esc(g.description||'')} · ${g.memberCount}人</p></div><button class="btn-sm" data-gid="${g.id}">加入</button>`;dv.querySelector('.btn-sm').onclick=async e=>{e.stopPropagation();try{const r2=await fetch('/api/groups/'+g.id+'/join',{method:'POST',credentials:'include'});const d2=await r2.json();if(d2.success){alert('已加入！');discoverGroupsModal.style.display='none';loadGroups()}else alert(d2.message)}catch(e){alert('操作失败')}};c.appendChild(dv)})}catch(e){c.innerHTML='<div style="text-align:center;color:#e53935;">加载失败</div>'}};
$('closeDiscoverGroupsBtn').onclick=()=>discoverGroupsModal.style.display='none';

groupMembersBtn.onclick=async()=>{
  if(currentGroupId===0)return;
  groupMembersModal.style.display='flex';const c=$('groupMemberList');$('memberCount').textContent='...';c.innerHTML='<div style="text-align:center;padding:20px;color:#999;">加载中...</div>';
  try{
    const r=await fetch(`/api/groups/${currentGroupId}/members`,{credentials:'include'});const d=await r.json();
    if(!d.success){c.innerHTML='<div style="text-align:center;color:#e53935;">加载失败</div>';return}
    $('memberCount').textContent=d.members.length;c.innerHTML='';
    const myGroup=myGroups.find(g=>g.id===currentGroupId),myRole=myGroup?myGroup.myRole:'member';
    d.members.forEach(m=>{
      const roleTag=m.role==='owner'?'👑群主':(m.role==='admin'?'⚙️管理员':'成员');
      let ah='';
      if(currentUser.userId!==m.userId&&(myRole==='owner'||(myRole==='admin'&&m.role==='member'))){
        if(m.role!=='owner'){
          if(myRole==='owner')ah+=`<button onclick="togAdmin(${currentGroupId},${m.userId},'${m.role==='admin'?'member':'admin'}')">${m.role==='admin'?'取消管理':'设为管理'}</button>`;
          ah+=`<button class="danger-btn" onclick="kickMem(${currentGroupId},${m.userId})">踢出</button>`
        }
      }
      if(currentUser.userId===m.userId&&m.role!=='owner')ah+=`<button onclick="leaveG(${currentGroupId})" style="color:#e53935;">退出群</button>`;
      const dv=document.createElement('div');dv.className='member-item';
      const av=m.avatarUrl||D;dv.innerHTML=`<img src="${esc(av)}"><div class="member-info"><div class="member-name">${esc(m.username)} <span class="member-role-tag">${roleTag}</span></div></div><div class="member-actions">${ah}</div>`;
      c.appendChild(dv)
    });
    if(d.members.some(m=>m.userId===currentUser.userId&&m.role==='owner')){
      const dd=document.createElement('div');dd.style.cssText='text-align:center;padding:12px;';
      dd.innerHTML=`<button style="color:#e53935;background:none;border:1px solid #e53935;border-radius:16px;padding:6px 16px;cursor:pointer;" onclick="delGroup(${currentGroupId})">🗑 解散群</button>`;
      c.appendChild(dd)}
  }catch(e){c.innerHTML='<div style="text-align:center;color:#e53935;">加载失败</div>'}
};
$('closeGroupMembersBtn').onclick=()=>groupMembersModal.style.display='none';

window.togAdmin=async(gid,uid,role)=>{try{const r=await fetch(`/api/groups/${gid}/set-role`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetUserId:uid,role})});const d=await r.json();alert(d.message);if(d.success)groupMembersBtn.click()}catch(e){}}
window.kickMem=async(gid,uid)=>{if(!confirm('踢出该成员？'))return;try{const r=await fetch(`/api/groups/${gid}/kick`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetUserId:uid})});const d=await r.json();alert(d.message);if(d.success)groupMembersBtn.click()}catch(e){}}
window.leaveG=async(gid)=>{if(!confirm('退出该群？'))return;try{const r=await fetch(`/api/groups/${gid}/leave`,{method:'POST',credentials:'include'});const d=await r.json();if(d.success){alert('已退出');$('groupMembersModal').style.display='none';switchGroup(0,'💬 公共聊天室');loadGroups()}else alert(d.message)}catch(e){}}
window.delGroup=async(gid)=>{if(!confirm('⚠️ 解散群？不可恢复！'))return;try{const r=await fetch(`/api/groups/${gid}`,{method:'DELETE',credentials:'include'});const d=await r.json();if(d.success){alert('已解散');$('groupMembersModal').style.display='none';switchGroup(0,'💬 公共聊天室');loadGroups()}else alert(d.message)}catch(e){}}

let initialized=false;
async function init(){
  if(initialized)return;initialized=true;
  const r=await fetch('/api/me',{credentials:'include'});const d=await r.json();
  if(!d.success){setTimeout(()=>window.location.href='/',100);return}
  currentUser=d.user;if(socket)socket.disconnect();
  socket=io({withCredentials:true});window.socket=socket;
  await loadGroups();
  socket.on('connect',async()=>{socket.emit('join chat');socket.emit('update status','chat');await loadHistory()});
  socket.on('history messages',msgs=>{if(!historyLoaded&&msgs.length&&currentGroupId===0){renderMessages(msgs);historyLoaded=true;hasMoreHistory=msgs.length===50;sendReads()}});
  socket.on('new message',msg=>{if(currentGroupId===0){appendMessage(msg);sendReads()}});
  socket.on('message recalled',({messageId})=>{if(currentGroupId===0){document.querySelector(`.message[data-id="${messageId}"]`)?.remove();sysMsg('一条消息已被撤回')}});
  socket.on('new group message',msg=>{if(currentGroupId===msg.groupId){appendMessage(msg);sendReads()}});
  socket.on('group message recalled',({messageId,groupId})=>{if(currentGroupId===groupId){document.querySelector(`.message[data-id="${messageId}"]`)?.remove();sysMsg('一条消息已被撤回')}});
  socket.on('online users status',renderOnline);
  socket.on('user updated',({userId,newAvatar})=>{if(currentUser.userId===userId&&newAvatar)currentUser.avatarUrl=newAvatar});
  socket.on('system message',sysMsg);
  socket.on('new announcement',({content,publisherName})=>{sysMsg(`【公告】${esc(publisherName)}:<br>${esc(content).replace(/\n/g,'<br>')}`)});
  socket.on('private message',msg=>{if(currentPrivateTarget&&currentPrivateTarget.id===msg.from_user){appendPM({...msg,username:currentPrivateTarget.username},false);socket.emit('mark private read',msg.from_user)}else{unreadCounts[msg.from_user]=(unreadCounts[msg.from_user]||0)+1;updBadge(msg.from_user,unreadCounts[msg.from_user])}});
  socket.on('new private message',({from,message})=>{if(currentPrivateTarget&&currentPrivateTarget.id===from){appendPM({...message,username:currentPrivateTarget.username},false);socket.emit('mark private read',from)}else{unreadCounts[from]=(unreadCounts[from]||0)+1;updBadge(from,unreadCounts[from])}});
  socket.on('kicked',()=>{window.location.href='/'});socket.on('user kicked',({username})=>{sysMsg('用户 '+esc(username)+' 已被踢出')});
}
init();