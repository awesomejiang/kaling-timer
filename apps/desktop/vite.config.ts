import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
 plugins:[react(),tailwindcss()],
 server:{port:1420,strictPort:true,proxy:{'/socket.io':{target:'http://127.0.0.1:3001',ws:true}}},
 build:{assetsInlineLimit:0,rollupOptions:{output:{manualChunks(id){
  if(id.includes('node_modules/zod/')||id.includes('node_modules/yaml/'))return 'validation';
  if(id.includes('node_modules/react')||id.includes('node_modules/scheduler/'))return 'react';
 }}}},clearScreen:false
});
