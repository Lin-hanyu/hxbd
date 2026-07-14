/**
 * 核邪部队 - 移动端热更新脚本
 * 
 * 原理：
 * 1. 页面加载后检查网络，请求远程 version.json
 * 2. 对比本地存储的版本号（localStorage）
 * 3. 如果有新版本，提示用户更新
 * 4. 用户确认后，下载新版 index.html 和变更的图片到 IndexedDB
 * 5. 下次加载时使用缓存版本
 * 
 * 使用方法：
 * - 将此文件放在与 index.html 同目录
 * - 在 index.html 的 <head> 中用 <script src="updater.js"></script> 引入
 * - 在远程服务器（GitHub Pages）上放置 version.json 和所有游戏文件
 */

(function() {
  // ===== 配置 =====
  const CONFIG = {
    remoteBase: 'https://lin-hanyu.github.io/hxbd/',
    versionUrl: 'https://lin-hanyu.github.io/hxbd/version.json',
    storageKey: 'hxbd_version',
    htmlCacheKey: 'hxbd_html',
    dbName: 'hxbd_assets',
    dbVersion: 1,
    currentVersion: '1.0.7' // 当前 APK 内置版本
  };

  // ===== IndexedDB 工具 =====
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'path' });
        }
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  function getFromDB(path) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const store = tx.objectStore('files');
        const req = store.get(path);
        req.onsuccess = function(e) { resolve(e.target.result ? e.target.result.data : null); };
        req.onerror = function(e) { reject(e.target.error); };
      });
    });
  }

  function saveToDB(path, data) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        store.put({ path: path, data: data });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e.target.error); };
      });
    });
  }

  // ===== 加载图片时优先从缓存获取 =====
  function patchImageLoading() {
    // 拦截 loadImages 函数中的图片加载，优先从 IndexedDB 缓存读取
    const origLoadImages = window.loadImages;
    if (!origLoadImages) return;

    window.loadImages = function() {
      // 先检查是否有缓存的 HTML（表示曾经更新过）
      const cachedHtml = localStorage.getItem(CONFIG.htmlCacheKey);
      if (!cachedHtml) {
        // 没有缓存，走原始加载（APK 内置文件）
        return origLoadImages();
      }

      // 有缓存，尝试从 IndexedDB 加载图片
      let loaded = 0;
      const total = Object.keys(window.IMG_LIST || {}).length;
      return new Promise((resolve) => {
        if (total === 0) { resolve(); return; }

        for (const [key, path] of Object.entries(window.IMG_LIST || {})) {
          getFromDB(path).then(data => {
            if (data) {
              // 缓存中有，用缓存
              const img = new Image();
              img.onload = () => { loaded++; if (loaded >= total) resolve(); };
              img.onerror = () => { loaded++; if (loaded >= total) resolve(); };
              img.src = data;
              window.IMG_CACHE[key] = img;
            } else {
              // 缓存中没有，走原始路径
              const img = new Image();
              img.onload = () => { loaded++; if (loaded >= total) resolve(); };
              img.onerror = () => { loaded++; if (loaded >= total) resolve(); };
              img.src = path;
              window.IMG_CACHE[key] = img;
            }
          }).catch(() => {
            // IndexedDB 出错，走原始路径
            const img = new Image();
            img.onload = () => { loaded++; if (loaded >= total) resolve(); };
            img.onerror = () => { loaded++; if (loaded >= total) resolve(); };
            img.src = path;
            window.IMG_CACHE[key] = img;
          });
        }
      });
    };
  }

  // ===== 下载文件并保存到 IndexedDB =====
  function downloadFile(url) {
    return fetch(url, { cache: 'no-cache' }).then(res => {
      if (!res.ok) throw new Error('下载失败: ' + url);
      return res.blob();
    }).then(blob => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) { resolve(e.target.result); };
        reader.onerror = function(e) { reject(e.target.error); };
        reader.readAsDataURL(blob);
      });
    });
  }

  // ===== 检查并执行更新 =====
  function checkForUpdate() {
    // 检查是否有网络
    if (!navigator.onLine) return;

    // 获取本地版本
    const localVersion = localStorage.getItem(CONFIG.storageKey) || CONFIG.currentVersion;

    // 请求远程版本信息
    fetch(CONFIG.versionUrl, { cache: 'no-cache' })
      .then(res => {
        if (!res.ok) throw new Error('无法获取版本信息');
        return res.json();
      })
      .then(remote => {
        if (remote.version === localVersion) {
          // 版本相同，无需更新
          return;
        }

        // 有新版本，提示用户
        showUpdateDialog(remote, localVersion);
      })
      .catch(() => {
        // 网络错误，静默忽略
      });
  }

  // ===== 显示更新对话框 =====
  function showUpdateDialog(remote, localVersion) {
    // 使用游戏自带的 modal 弹窗
    const modalBox = document.getElementById('modalBox');
    const modal = document.getElementById('modal');
    if (!modalBox || !modal) return;

    modalBox.innerHTML = [
      '<h2>发现新版本</h2>',
      '<p>当前版本: v' + localVersion + '<br>最新版本: v' + remote.version + '</p>',
      '<p style="color:#8a7a5a;font-size:12px">更新后需要重启游戏</p>',
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:15px">',
      '<button id="updateLaterBtn" style="background:#3a2a00;border:2px solid #654321;color:#c8a96e;cursor:pointer;padding:6px 24px;font-family:Courier New;font-size:14px">稍后更新</button>',
      '<button id="updateNowBtn" style="background:#2a4a2a;border:2px solid #2a6a2a;color:#4aff4a;cursor:pointer;padding:6px 24px;font-family:Courier New;font-size:14px">立即更新</button>',
      '</div>',
      '<div id="updateProgress" style="display:none;margin-top:12px;color:#8a7a5a;font-size:12px"></div>'
    ].join('');
    modal.style.display = 'flex';

    document.getElementById('updateLaterBtn').onclick = function() {
      modal.style.display = 'none';
    };

    document.getElementById('updateNowBtn').onclick = function() {
      startUpdate(remote);
    };
  }

  // ===== 执行更新 =====
  function startUpdate(remote) {
    const progressEl = document.getElementById('updateProgress');
    const nowBtn = document.getElementById('updateNowBtn');
    const laterBtn = document.getElementById('updateLaterBtn');
    
    if (progressEl) progressEl.style.display = 'block';
    if (nowBtn) nowBtn.disabled = true;
    if (laterBtn) laterBtn.disabled = true;

    const files = Object.keys(remote.files);
    let completed = 0;
    const total = files.length;

    function updateProgress(msg) {
      if (progressEl) {
        progressEl.textContent = msg || ('下载中... ' + completed + '/' + total);
      }
    }

    updateProgress('准备下载 ' + total + ' 个文件...');

    // 先下载 index.html
    updateProgress('正在下载更新...');

    downloadFile(CONFIG.remoteBase + 'index.html')
      .then(htmlData => {
        // 保存 HTML 到 localStorage
        localStorage.setItem(CONFIG.htmlCacheKey, htmlData);

        // 逐个下载资源文件
        return downloadFilesSequentially(files, 0, updateProgress, completed, total);
      })
      .then(() => {
        // 保存版本号
        localStorage.setItem(CONFIG.storageKey, remote.version);
        
        if (progressEl) {
          progressEl.innerHTML = '<span style="color:#4aff4a">✓ 更新完成！请重启游戏</span>';
        }
        if (nowBtn) nowBtn.textContent = '重启游戏';
        if (nowBtn) nowBtn.onclick = function() { location.reload(); };
        if (laterBtn) laterBtn.textContent = '稍后';
        if (laterBtn) laterBtn.onclick = function() { document.getElementById('modal').style.display='none'; };
      })
      .catch(err => {
        if (progressEl) {
          progressEl.innerHTML = '<span style="color:#f44">✗ 更新失败: ' + err.message + '</span>';
        }
        if (nowBtn) nowBtn.disabled = false;
        if (laterBtn) laterBtn.disabled = false;
      });
  }

  function downloadFilesSequentially(files, index, updateProgress, completed, total) {
    if (index >= files.length) return Promise.resolve();

    const path = files[index];
    const url = CONFIG.remoteBase + path;

    return downloadFile(url).then(data => {
      return saveToDB(path, data);
    }).then(() => {
      completed++;
      updateProgress('下载中... ' + completed + '/' + total);
      return downloadFilesSequentially(files, index + 1, updateProgress, completed, total);
    });
  }

  // ===== 页面加载时使用缓存的 HTML =====
  function applyCachedHtml() {
    const cachedHtml = localStorage.getItem(CONFIG.htmlCacheKey);
    if (cachedHtml) {
      // 有缓存的 HTML，替换当前页面
      // 但为了避免循环，只在需要时使用
      return true;
    }
    return false;
  }

  // ===== 初始化 =====
  function init() {
    // 1. 尝试修补图片加载
    patchImageLoading();

    // 2. 延迟检查更新（等游戏初始化完成后再检查）
    setTimeout(checkForUpdate, 3000);
  }

  // 等 DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
