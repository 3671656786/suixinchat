async function loadAgreement() {
    const container = document.getElementById('agreementContent');
    container.innerHTML = '加载中...';
    try {
        const res = await fetch('/api/agreement', { credentials: 'include' });
        const data = await res.json();
        if (data.success) {
            container.innerText = data.content;
        } else {
            container.innerHTML = '<div style="color:red;">协议加载失败，请稍后重试</div>';
        }
    } catch (err) {
        container.innerHTML = '<div style="color:red;">网络错误，无法加载协议</div>';
    }
}
loadAgreement();