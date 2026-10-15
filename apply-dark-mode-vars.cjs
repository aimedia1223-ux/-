const fs = require('fs');
const path = require('path');

function replaceInDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceInDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Replace hardcoded whites for backgrounds
      content = content.replace(/background:\s*'white'/g, "background: 'var(--surface-color)'");
      content = content.replace(/background:\s*"white"/g, "background: 'var(--surface-color)'");
      content = content.replace(/backgroundColor:\s*'white'/g, "backgroundColor: 'var(--surface-color)'");
      content = content.replace(/backgroundColor:\s*"white"/g, "backgroundColor: 'var(--surface-color)'");
      content = content.replace(/background:\s*'#fff'/gi, "background: 'var(--surface-color)'");
      content = content.replace(/background:\s*'#ffffff'/gi, "background: 'var(--surface-color)'");
      
      // Replace some text colors
      content = content.replace(/color:\s*'#333'/g, "color: 'var(--text-main)'");
      content = content.replace(/color:\s*'#666'/g, "color: 'var(--text-sub)'");
      content = content.replace(/color:\s*'#999'/g, "color: 'var(--text-muted, #9CA3AF)'");
      
      // Box shadows that assume white background
      content = content.replace(/boxShadow:\s*'0 2px 5px rgba\(0,0,0,0.1\)'/g, "boxShadow: 'var(--shadow-sm)'");
      content = content.replace(/boxShadow:\s*'0 4px 12px rgba\(0,0,0,0.05\)'/g, "boxShadow: 'var(--shadow-md)'");
      
      fs.writeFileSync(fullPath, content, 'utf8');
    }
  }
}

replaceInDir(path.join(__dirname, 'src'));
console.log('Replaced inline styles with CSS variables for Dark Mode compatibility.');
