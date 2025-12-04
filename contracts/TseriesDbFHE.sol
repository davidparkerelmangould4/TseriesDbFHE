// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TseriesDbFHE is SepoliaConfig {
    struct EncryptedDataPoint {
        uint256 id;
        euint32 encryptedValue;
        euint32 encryptedTimestamp;
        euint32 encryptedSeriesId;
        uint256 storedAt;
    }
    
    struct DecryptedDataPoint {
        uint256 value;
        uint256 timestamp;
        string seriesId;
        bool isRevealed;
    }

    uint256 public dataPointCount;
    mapping(uint256 => EncryptedDataPoint) public encryptedDataPoints;
    mapping(uint256 => DecryptedDataPoint) public decryptedDataPoints;
    
    mapping(string => euint32) private encryptedSeriesStats;
    string[] private seriesList;
    
    mapping(uint256 => uint256) private requestToDataPointId;
    
    event DataPointAdded(uint256 indexed id, uint256 storedAt);
    event AnalysisRequested(uint256 indexed id);
    event DataPointRevealed(uint256 indexed id);
    
    modifier onlyDataOwner(uint256 dataPointId) {
        _;
    }
    
    function addEncryptedDataPoint(
        euint32 encryptedValue,
        euint32 encryptedTimestamp,
        euint32 encryptedSeriesId
    ) public {
        dataPointCount += 1;
        uint256 newId = dataPointCount;
        
        encryptedDataPoints[newId] = EncryptedDataPoint({
            id: newId,
            encryptedValue: encryptedValue,
            encryptedTimestamp: encryptedTimestamp,
            encryptedSeriesId: encryptedSeriesId,
            storedAt: block.timestamp
        });
        
        decryptedDataPoints[newId] = DecryptedDataPoint({
            value: 0,
            timestamp: 0,
            seriesId: "",
            isRevealed: false
        });
        
        emit DataPointAdded(newId, block.timestamp);
    }
    
    function requestDataAnalysis(uint256 dataPointId) public onlyDataOwner(dataPointId) {
        EncryptedDataPoint storage dp = encryptedDataPoints[dataPointId];
        require(!decryptedDataPoints[dataPointId].isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(dp.encryptedValue);
        ciphertexts[1] = FHE.toBytes32(dp.encryptedTimestamp);
        ciphertexts[2] = FHE.toBytes32(dp.encryptedSeriesId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeDataPoint.selector);
        requestToDataPointId[reqId] = dataPointId;
        
        emit AnalysisRequested(dataPointId);
    }
    
    function analyzeDataPoint(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataPointId = requestToDataPointId[requestId];
        require(dataPointId != 0, "Invalid request");
        
        EncryptedDataPoint storage eDp = encryptedDataPoints[dataPointId];
        DecryptedDataPoint storage dDp = decryptedDataPoints[dataPointId];
        require(!dDp.isRevealed, "Already revealed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint256 value, uint256 timestamp, string memory seriesId) = 
            abi.decode(cleartexts, (uint256, uint256, string));
        
        dDp.value = value;
        dDp.timestamp = timestamp;
        dDp.seriesId = seriesId;
        dDp.isRevealed = true;
        
        if (FHE.isInitialized(encryptedSeriesStats[dDp.seriesId]) == false) {
            encryptedSeriesStats[dDp.seriesId] = FHE.asEuint32(0);
            seriesList.push(dDp.seriesId);
        }
        encryptedSeriesStats[dDp.seriesId] = FHE.add(
            encryptedSeriesStats[dDp.seriesId], 
            FHE.asEuint32(1)
        );
        
        emit DataPointRevealed(dataPointId);
    }
    
    function getDecryptedDataPoint(uint256 dataPointId) public view returns (
        uint256 value,
        uint256 timestamp,
        string memory seriesId,
        bool isRevealed
    ) {
        DecryptedDataPoint storage dp = decryptedDataPoints[dataPointId];
        return (dp.value, dp.timestamp, dp.seriesId, dp.isRevealed);
    }
    
    function getEncryptedSeriesStats(string memory seriesId) public view returns (euint32) {
        return encryptedSeriesStats[seriesId];
    }
    
    function requestSeriesStatsDecryption(string memory seriesId) public {
        euint32 stats = encryptedSeriesStats[seriesId];
        require(FHE.isInitialized(stats), "Series not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSeriesStats.selector);
        requestToDataPointId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(seriesId)));
    }
    
    function decryptSeriesStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 seriesHash = requestToDataPointId[requestId];
        string memory seriesId = getSeriesFromHash(seriesHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getSeriesFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < seriesList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(seriesList[i]))) == hash) {
                return seriesList[i];
            }
        }
        revert("Series not found");
    }
    
    function calculateWindowAverage(
        string memory targetSeriesId,
        uint256 startTime,
        uint256 endTime
    ) public view returns (uint256 average) {
        uint256 sum = 0;
        uint256 count = 0;
        
        for (uint256 i = 1; i <= dataPointCount; i++) {
            if (decryptedDataPoints[i].isRevealed && 
                keccak256(abi.encodePacked(decryptedDataPoints[i].seriesId)) == keccak256(abi.encodePacked(targetSeriesId)) &&
                decryptedDataPoints[i].timestamp >= startTime &&
                decryptedDataPoints[i].timestamp <= endTime) {
                sum += decryptedDataPoints[i].value;
                count++;
            }
        }
        
        return count > 0 ? sum / count : 0;
    }
}