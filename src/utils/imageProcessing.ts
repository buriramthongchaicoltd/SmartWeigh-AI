export const optimizeImageForAI = (file: File, maxDim = 1800, quality = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('อ่านไฟล์ภาพไม่สำเร็จ'));
    reader.onload = (e) => {
      const rawData = e.target?.result;
      if (typeof rawData !== 'string') {
        reject(new Error('อ่านข้อมูลไฟล์ภาพไม่สำเร็จ'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(rawData);
        }
      };
      img.onerror = () => resolve(rawData);
      img.src = rawData;
    };
    reader.readAsDataURL(file);
  });
};
