import {defineConfig} from 'vite';
export default defineConfig({build:{rollupOptions:{input:{app:'index.html',cardPreview:'card-preview.html'},onwarn(warning,warn){if(warning.code==='MODULE_LEVEL_DIRECTIVE'||warning.code==='INVALID_ANNOTATION')return;warn(warning);}}}});
