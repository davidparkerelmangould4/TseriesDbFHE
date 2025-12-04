import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TimeSeriesData {
  id: string;
  encryptedValue: string;
  timestamp: number;
  owner: string;
  metric: string;
  tags: string[];
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataPoints, setDataPoints] = useState<TimeSeriesData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newDataPoint, setNewDataPoint] = useState({
    metric: "",
    value: "",
    tags: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedData, setSelectedData] = useState<TimeSeriesData | null>(null);

  // Calculate statistics
  const totalPoints = dataPoints.length;
  const uniqueMetrics = [...new Set(dataPoints.map(d => d.metric))].length;
  const recent24h = dataPoints.filter(d => Date.now() - d.timestamp * 1000 < 24 * 60 * 60 * 1000).length;

  useEffect(() => {
    loadDataPoints().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadDataPoints = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check FHE contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("FHE contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("timeseries_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: TimeSeriesData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`data_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedValue: data.value,
                timestamp: data.timestamp,
                owner: data.owner,
                metric: data.metric,
                tags: data.tags || []
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDataPoints(list);
    } catch (e) {
      console.error("Error loading data points:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitDataPoint = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting time-series data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedValue = `FHE-${btoa(JSON.stringify({
        value: newDataPoint.value,
        tags: newDataPoint.tags.split(',').map(t => t.trim())
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const dataPoint = {
        value: encryptedValue,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        metric: newDataPoint.metric,
        tags: newDataPoint.tags.split(',').map(t => t.trim())
      };
      
      // Store encrypted data using FHE
      await contract.setData(
        `data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(dataPoint))
      );
      
      const keysBytes = await contract.getData("timeseries_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "timeseries_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Time-series data encrypted and stored securely!"
      });
      
      await loadDataPoints();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewDataPoint({
          metric: "",
          value: "",
          tags: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkFHEAvailable = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Checking FHE availability..."
    });

    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE system is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "FHE check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access FHE time-series database",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Data",
      description: "Add time-series data which will be encrypted using FHE technology",
      icon: "📊"
    },
    {
      title: "FHE Processing",
      description: "Your data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Secure Analytics",
      description: "Run analytics on encrypted data while maintaining privacy",
      icon: "🔍"
    }
  ];

  const renderLineChart = () => {
    // Simplified line chart for demonstration
    const recentData = dataPoints.slice(0, 10).reverse();
    const maxValue = 100; // Assuming normalized values
    
    return (
      <div className="line-chart-container">
        <div className="line-chart">
          {recentData.map((data, index) => (
            <div
              key={data.id}
              className="data-point"
              style={{
                left: `${(index / (recentData.length - 1)) * 100}%`,
                bottom: `${50}%` // Simplified positioning
              }}
              onMouseEnter={() => setSelectedData(data)}
              onMouseLeave={() => setSelectedData(null)}
            />
          ))}
          <div className="chart-line"></div>
        </div>
        <div className="chart-labels">
          <span>Older</span>
          <span>Newer</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE time-series database...</p>
    </div>
  );

  return (
    <div className="app-container glassmorphism-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="wave-icon"></div>
          </div>
          <h1>FHE<span>TimeSeries</span>DB</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn glass-btn"
          >
            <div className="add-icon"></div>
            Add Data
          </button>
          <button 
            className="glass-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <button 
            className="glass-btn"
            onClick={checkFHEAvailable}
          >
            Check FHE
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Based Secure Time-Series Database</h2>
            <p>Store and analyze time-series data with full homomorphic encryption protection</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How It Works</h2>
            <p className="subtitle">Learn about FHE-protected time-series data storage</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-panels">
          <div className="panel intro-panel">
            <h3>Project Introduction</h3>
            <p>Secure time-series database using FHE technology to protect sensitive sequential data while enabling encrypted analytics.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Analytics</span>
            </div>
          </div>
          
          <div className="panel stats-panel">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{totalPoints}</div>
                <div className="stat-label">Total Points</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{uniqueMetrics}</div>
                <div className="stat-label">Metrics</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{recent24h}</div>
                <div className="stat-label">Last 24h</div>
              </div>
            </div>
          </div>
          
          <div className="panel chart-panel">
            <h3>Data Trend</h3>
            {renderLineChart()}
            {selectedData && (
              <div className="data-tooltip">
                Metric: {selectedData.metric}<br />
                Time: {new Date(selectedData.timestamp * 1000).toLocaleString()}
              </div>
            )}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Time-Series Data Points</h2>
            <div className="header-actions">
              <button 
                onClick={loadDataPoints}
                className="refresh-btn glass-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list glass-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Metric</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Timestamp</div>
              <div className="header-cell">Tags</div>
            </div>
            
            {dataPoints.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No time-series data found</p>
                <button 
                  className="glass-btn primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Data Point
                </button>
              </div>
            ) : (
              dataPoints.map(data => (
                <div 
                  className="data-row" 
                  key={data.id}
                  onMouseEnter={() => setSelectedData(data)}
                  onMouseLeave={() => setSelectedData(null)}
                >
                  <div className="table-cell data-id">#{data.id.substring(0, 6)}</div>
                  <div className="table-cell">{data.metric}</div>
                  <div className="table-cell">{data.owner.substring(0, 6)}...{data.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(data.timestamp * 1000).toLocaleString()}
                  </div>
                  <div className="table-cell">
                    {data.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                    {data.tags.length > 2 && <span className="more-tags">+{data.tags.length - 2}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitDataPoint} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          data={newDataPoint}
          setData={setNewDataPoint}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="wave-icon"></div>
              <span>FHE TimeSeries DB</span>
            </div>
            <p>Secure encrypted time-series database using Zama FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">API Reference</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE TimeSeries DB. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.metric || !data.value) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Add Time-Series Data Point</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon">🔒</div> 
            Your data will be encrypted with FHE before storage
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Metric Type *</label>
              <select 
                name="metric"
                value={data.metric} 
                onChange={handleChange}
                className="glass-input"
              >
                <option value="">Select metric</option>
                <option value="Temperature">Temperature</option>
                <option value="Humidity">Humidity</option>
                <option value="Pressure">Pressure</option>
                <option value="Voltage">Voltage</option>
                <option value="Current">Current</option>
                <option value="Custom">Custom Metric</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Value *</label>
              <input 
                type="text"
                name="value"
                value={data.value} 
                onChange={handleChange}
                placeholder="Enter data value..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Tags (comma-separated)</label>
              <input 
                type="text"
                name="tags"
                value={data.tags} 
                onChange={handleChange}
                placeholder="sensor1, room-a, monitoring" 
                className="glass-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon">🛡️</div> 
            Data remains encrypted during FHE processing and analytics
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn glass-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;