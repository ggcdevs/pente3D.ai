import { downloadFile, generateFilename, uploadFile, uploadMultipleFiles } from '@/utils/fileIO';

describe('fileIO utilities', () => {
  describe('downloadFile', () => {
    let createElementSpy: jest.SpyInstance;
    let createObjectURLSpy: jest.SpyInstance;
    let revokeObjectURLSpy: jest.SpyInstance;
    let mockLink: HTMLAnchorElement;

    beforeEach(() => {
      mockLink = {
        href: '',
        download: '',
        click: jest.fn()
      } as unknown as HTMLAnchorElement;

      createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockLink);
      // @ts-ignore - Mocking URL methods
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
      // @ts-ignore - Mocking URL methods
      global.URL.revokeObjectURL = jest.fn();
      createObjectURLSpy = global.URL.createObjectURL as jest.Mock;
      revokeObjectURLSpy = global.URL.revokeObjectURL as jest.Mock;
      
      jest.spyOn(document.body, 'appendChild').mockImplementation();
      jest.spyOn(document.body, 'removeChild').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create and click download link', () => {
      const content = '{"test": "data"}';
      const filename = 'test.json';

      downloadFile(content, filename);

      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(createObjectURLSpy).toHaveBeenCalledWith(expect.any(Blob));
      expect(mockLink.href).toBe('blob:mock-url');
      expect(mockLink.download).toBe(filename);
      expect(mockLink.click).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should use custom mime type', () => {
      downloadFile('test content', 'test.txt', 'text/plain');

      const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
      expect(blobCall.type).toBe('text/plain');
    });

    it('should append and remove link from body', () => {
      const appendSpy = jest.spyOn(document.body, 'appendChild');
      const removeSpy = jest.spyOn(document.body, 'removeChild');

      downloadFile('content', 'file.json');

      expect(appendSpy).toHaveBeenCalledWith(mockLink);
      expect(removeSpy).toHaveBeenCalledWith(mockLink);
    });
  });

  describe('generateFilename', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-15T14:30:45.123Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should generate filename with timestamp', () => {
      const filename = generateFilename();
      expect(filename).toBe('pente3d_game_2025-01-15T14-30-45.json');
    });

    it('should use custom game name', () => {
      const filename = generateFilename('My Game');
      expect(filename).toBe('My_Game_2025-01-15T14-30-45.json');
    });

    it('should sanitize game name', () => {
      const filename = generateFilename('My Game! #1 @home');
      expect(filename).toBe('My_Game___1__home_2025-01-15T14-30-45.json');
    });

    it('should use custom extension', () => {
      const filename = generateFilename('test', 'txt');
      expect(filename).toBe('test_2025-01-15T14-30-45.txt');
    });
  });

  describe('uploadFile', () => {
    let mockInput: HTMLInputElement;
    let createElementSpy: jest.SpyInstance;

    beforeEach(() => {
      mockInput = {
        type: '',
        accept: '',
        click: jest.fn(),
        onchange: null,
        oncancel: null
      } as unknown as HTMLInputElement;

      createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockInput);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create file input and trigger click', async () => {
      const promise = uploadFile();

      expect(createElementSpy).toHaveBeenCalledWith('input');
      expect(mockInput.type).toBe('file');
      expect(mockInput.accept).toBe('.json');
      expect(mockInput.click).toHaveBeenCalled();

      // Cancel to resolve the promise
      mockInput.oncancel?.({} as Event);
      await expect(promise).rejects.toThrow('File selection cancelled');
    });

    it('should resolve with file content', async () => {
      const mockFile = {
        name: 'test.json',
        text: jest.fn().mockResolvedValue('{"test": "content"}')
      } as unknown as File;

      const promise = uploadFile();

      // Simulate file selection
      const changeEvent = {
        target: { files: [mockFile] }
      } as unknown as Event;
      mockInput.onchange?.(changeEvent);

      const result = await promise;
      expect(result.content).toBe('{"test": "content"}');
      expect(result.filename).toBe('test.json');
    });

    it('should reject if no file selected', async () => {
      const promise = uploadFile();

      const changeEvent = {
        target: { files: [] }
      } as unknown as Event;
      mockInput.onchange?.(changeEvent);

      await expect(promise).rejects.toThrow('No file selected');
    });

    it('should reject if file read fails', async () => {
      const mockFile = {
        name: 'test.json',
        text: jest.fn().mockRejectedValue(new Error('Read error'))
      } as unknown as File;

      const promise = uploadFile();

      const changeEvent = {
        target: { files: [mockFile] }
      } as unknown as Event;
      mockInput.onchange?.(changeEvent);

      await expect(promise).rejects.toThrow('Failed to read file: Read error');
    });

    it('should use custom accept parameter', () => {
      uploadFile('.txt');
      expect(mockInput.accept).toBe('.txt');
    });
  });

  describe('uploadMultipleFiles', () => {
    let mockInput: HTMLInputElement;
    let createElementSpy: jest.SpyInstance;

    beforeEach(() => {
      mockInput = {
        type: '',
        accept: '',
        multiple: false,
        click: jest.fn(),
        onchange: null,
        oncancel: null
      } as unknown as HTMLInputElement;

      createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockInput);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create file input with multiple attribute', async () => {
      const promise = uploadMultipleFiles();

      expect(createElementSpy).toHaveBeenCalledWith('input');
      expect(mockInput.type).toBe('file');
      expect(mockInput.accept).toBe('.json');
      expect(mockInput.multiple).toBe(true);
      expect(mockInput.click).toHaveBeenCalled();

      // Cancel to resolve the promise
      mockInput.oncancel?.({} as Event);
      await expect(promise).rejects.toThrow('File selection cancelled');
    });

    it('should resolve with multiple file contents', async () => {
      const mockFiles = [
        {
          name: 'file1.json',
          text: jest.fn().mockResolvedValue('{"file": 1}')
        },
        {
          name: 'file2.json',
          text: jest.fn().mockResolvedValue('{"file": 2}')
        }
      ] as unknown as File[];

      const promise = uploadMultipleFiles();

      const changeEvent = {
        target: { files: mockFiles }
      } as unknown as Event;
      mockInput.onchange?.(changeEvent);

      const results = await promise;
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ content: '{"file": 1}', filename: 'file1.json' });
      expect(results[1]).toEqual({ content: '{"file": 2}', filename: 'file2.json' });
    });

    it('should reject if no files selected', async () => {
      const promise = uploadMultipleFiles();

      const changeEvent = {
        target: { files: [] }
      } as unknown as Event;
      mockInput.onchange?.(changeEvent);

      await expect(promise).rejects.toThrow('No files selected');
    });

    it('should reject if any file read fails', async () => {
      const mockFiles = [
        {
          name: 'file1.json',
          text: jest.fn().mockResolvedValue('{"file": 1}')
        },
        {
          name: 'file2.json',
          text: jest.fn().mockRejectedValue(new Error('Read error'))
        }
      ] as unknown as File[];

      const promise = uploadMultipleFiles();

      const changeEvent = {
        target: { files: mockFiles }
      } as unknown as Event;
      mockInput.onchange?.(changeEvent);

      await expect(promise).rejects.toThrow('Failed to read files: Read error');
    });
  });
});