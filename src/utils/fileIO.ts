export function downloadFile(content: string, filename: string, mimeType: string = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  
  // Append to body, click, and remove
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL
  URL.revokeObjectURL(url);
}

export function generateFilename(gameName?: string, extension: string = 'json'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const baseName = gameName ? gameName.replace(/[^a-zA-Z0-9-_]/g, '_') : 'pente3d_game';
  return `${baseName}_${timestamp}.${extension}`;
}

export function uploadFile(accept: string = '.json'): Promise<{ content: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    
    input.onchange = async (event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      
      try {
        const content = await file.text();
        resolve({ content, filename: file.name });
      } catch (error) {
        reject(new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };
    
    input.oncancel = () => {
      reject(new Error('File selection cancelled'));
    };
    
    // Trigger file selection
    input.click();
  });
}

export async function uploadMultipleFiles(accept: string = '.json'): Promise<{ content: string; filename: string }[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    
    input.onchange = async (event) => {
      const target = event.target as HTMLInputElement;
      const files = target.files;
      
      if (!files || files.length === 0) {
        reject(new Error('No files selected'));
        return;
      }
      
      try {
        const results = await Promise.all(
          Array.from(files).map(async (file) => ({
            content: await file.text(),
            filename: file.name
          }))
        );
        resolve(results);
      } catch (error) {
        reject(new Error(`Failed to read files: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };
    
    input.oncancel = () => {
      reject(new Error('File selection cancelled'));
    };
    
    // Trigger file selection
    input.click();
  });
}