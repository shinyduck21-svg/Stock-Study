import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'post-management-api',
      configureServer(server) {
        server.middlewares.use('/api/add-post', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const newPostData = JSON.parse(body);
                const postsFilePath = path.resolve(__dirname, 'public/data/posts.json');
                const posts = JSON.parse(fs.readFileSync(postsFilePath, 'utf-8'));

                // New ID generation
                const nextId = posts.length > 0 ? Math.max(...posts.map(p => p.id)) + 1 : 1;

                // Construct new post
                const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 전';
                const fileName = `briefing_${String(nextId).padStart(2, '0')}.md`;

                const finalPost = {
                  id: nextId,
                  title: newPostData.title,
                  time: '방금 전',
                  type: newPostData.type || 'text',
                  category: newPostData.category,
                  likes: 0,
                  isRead: false,
                  isNew: true,
                  fileName: fileName
                };

                // Add optional media links if provided
                if (newPostData.url && newPostData.url.trim()) {
                  let videoUrl = newPostData.url.trim();
                  // Transform Google Drive view links to preview
                  if (videoUrl.includes('drive.google.com') && videoUrl.includes('/view')) {
                    videoUrl = videoUrl.replace(/\/view(\?.*)?$/, '/preview');
                  }
                  finalPost.url = videoUrl;
                  finalPost.type = 'video'; // Auto-detect video type if URL is present
                }

                if (newPostData.audioUrl && newPostData.audioUrl.trim()) {
                  finalPost.audioUrl = newPostData.audioUrl.trim();
                  if (finalPost.type !== 'video') finalPost.type = 'audio';
                }

                // Add to start of array (newest first)
                posts.unshift(finalPost);
                fs.writeFileSync(postsFilePath, JSON.stringify(posts, null, 4));

                // Create initial markdown file
                const docPath = path.resolve(__dirname, `public/docs/${fileName}`);
                const initialContent = newPostData.content || `# ${newPostData.title}\n\n내용을 입력해 주세요.`;
                fs.writeFileSync(docPath, initialContent);

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, post: finalPost }));
              } catch (err) {
                console.error('Error adding post:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else {
            next();
          }
        });
      }
    }
  ],
  base: '/Stock-Study/',
})
