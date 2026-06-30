import { useState } from 'react';
import { useChunkedUpload } from 'react-chunked-upload';
import './App.css';

function App() {
  const [file, setFile] = useState<File | null>(null);
  
  const { 
    startUpload, 
    pauseUpload, 
    resumeUpload, 
    retryUpload,
    progress, 
    isUploading, 
    isPaused, 
    isError, 
    isSuccess 
  } = useChunkedUpload({
    chunkSize: 1024 * 1024 * 5, // 5MB chunks
    uploadUrl: '/api/upload-chunk',
    onSuccess: () => console.log('Upload successful!'),
    onError: (err) => console.error(err),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleStart = () => {
    if (file) startUpload(file);
  };

  return (
    <div className="App" style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h1>react-chunked-upload Demo</h1>
      <p>Select a file to test the chunked upload process against the local mock endpoint.</p>
      
      <div style={{ margin: '20px 0' }}>
        <input type="file" onChange={handleFileChange} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} />
      </div>
      
      <div style={{ display: 'flex', gap: '10px' }}>
        {!isUploading && !isPaused && !isSuccess && (
          <button 
            onClick={handleStart} 
            disabled={!file}
            style={{ padding: '10px 20px', backgroundColor: '#3B82F6', color: 'white', border: 'none', borderRadius: '4px', cursor: file ? 'pointer' : 'not-allowed' }}
          >
            Start Upload
          </button>
        )}
        
        {isUploading && (
          <button 
            onClick={pauseUpload}
            style={{ padding: '10px 20px', backgroundColor: '#F59E0B', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Pause Upload
          </button>
        )}
        
        {isPaused && (
          <button 
            onClick={resumeUpload}
            style={{ padding: '10px 20px', backgroundColor: '#10B981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Resume Upload
          </button>
        )}

        {isError && (
          <button
            onClick={retryUpload}
            style={{ padding: '10px 20px', backgroundColor: '#DC2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Retry Upload
          </button>
        )}
      </div>

      <div style={{ marginTop: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontWeight: 'bold' }}>Progress</span>
          <span>{progress}%</span>
        </div>
        <div style={{ 
          width: '100%', 
          height: '24px', 
          backgroundColor: '#E5E7EB',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            width: `${progress}%`, 
            height: '100%', 
            backgroundColor: isError ? '#EF4444' : isSuccess ? '#10B981' : '#3B82F6',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#F3F4F6', borderRadius: '8px', fontSize: '14px' }}>
        <p style={{ margin: 0 }}>
          <strong>Status: </strong> 
          {isError ? <span style={{ color: '#EF4444' }}>Error occurred</span> : 
           isSuccess ? <span style={{ color: '#10B981' }}>Upload complete!</span> : 
           isPaused ? <span style={{ color: '#F59E0B' }}>Paused</span> : 
           isUploading ? <span style={{ color: '#3B82F6' }}>Uploading...</span> : 
           'Idle'}
        </p>
      </div>
    </div>
  );
}

export default App;
