class ParticleRev extends AudioWorkletProcessor {
    constructor() {
        super();

        this.allProcessedFrameNum = 0;
        this.allProcessedBlockNum = 0;

        this.particleGain = 1.5;        // <0 ~ >2
        this.particleNum = 0;
        this.poly = 675;                // 675 (375 * lengthMaxSec)

        this.sampleRate = 48000;
        this.windowSize = 1024;
        this.windowCh = 128;
        this.preparedWindow = new Float32Array(this.windowSize * this.windowCh).fill(0);

        this.initWindow();

        this.rawSig = [
            new Float32Array(this.sampleRate * 2).fill(0),  // L
            new Float32Array(this.sampleRate * 2).fill(0)   // R
        ];

        this.delayedSigCh = 0;
        this.delayedSig = new Array(this.poly * 2);

        this.lengthMaxSec = 1.5;    // Set same param in main script
        this.lengthMinRate = 0.8;
        this.lengthRange = 0.175;   // (lengthMinRate + lengthRange) must be less than 1
        this.interval = this.lengthMaxSec / this.poly;

        this.delayMaxSec = 0.8;
        this.delayMinRate = 0.2;
        this.delayRange = 0.75;     // (delayMinRate + delayRange) must be less than 1

        this.volumeMinRate = 0.7;
        this.volumeRange = 0.25

        this.lengthMaxSamples = this.lengthMaxSec * this.sampleRate;
        this.delayMaxSamples = this.delayMaxSec * this.sampleRate;
        this.intervalSamples = this.interval * this.sampleRate;
    }

    // Set window function
    initWindow() {
        for (let i = 0; i < this.windowCh; i++) {
            let check1 = i * this.windowSize / (2 * this.windowCh);
            let check2 = this.windowSize - check1;
            let rate = 1 - 0.6 * Math.pow(i / (this.windowCh - 1), 0.2);
            let val;
            
            for (let j = 0; j < this.windowSize; j++) {
                if (j < check1) {
                    val = 0.5 - 0.5 * Math.cos(Math.PI * j / check1);
                } else if (j >= check1 && j < check2) {
                    val = 1;
                } else {
                    val = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((j - check2) / (2 * check1) + 0.5));
                }
                
                let valIndex = j * this.windowCh + (this.windowCh - i - 1);
                this.preparedWindow[valIndex] = val * rate;
            }
        }
    }

    process(inputs, outputs) {
        const input = inputs[0], // Float32Array with 256 elements. First 128: 0ch, Latter 128: 1ch
              output = outputs[0],
              chNum = output.length;
        
        if (input[0]) {
            if (chNum === 2) {
                // Set random length depending on "lengthRange" of each particle
                // "lengthFluctuation" should be within 0 - 1 (in any case, it will be clipped after all)
                let lengthFluctuation = this.lengthMinRate + (this.lengthRange * Math.random());
                let lengthMaster = Math.floor(this.lengthMaxSamples * lengthFluctuation);

                // Set random delay amount depending on "delayRange" of each particle
                let delayFluctuation = this.delayMinRate + (this.delayRange * Math.random());
                let delayMaster = Math.floor(this.delayMaxSamples * delayFluctuation);

                // Set random volume amount depending on "volumeRange" of each particle
                let volumeMaster = this.volumeMinRate + (this.volumeRange * Math.random());

                // Set which channel of window function buffer to use
                let wavetableCh = Math.ceil(Math.max(((1 - lengthFluctuation) * this.windowCh), 0));

                
                // PROCESSING FOR EACH CHANNEL
                for (let ch = 0; ch < chNum; ch++) { 
                    // ch.0: L, ch.1: R
                    const inputCh = input[ch],
                          outputCh = output[ch],
                          rawSig = this.rawSig[ch];
                    
                    // Avoid double counting
                    if (ch === 1) this.allProcessedFrameNum -= inputCh.length;

                    // PROCESSING FOR EACH SAMPLE OF INPUT
                    for (let i = 0; i < inputCh.length; i++) {
                        const rawSigIndex = this.allProcessedFrameNum % rawSig.length;
    
                        // Store input source
                        rawSig[rawSigIndex] = inputCh[i];
                        
                        this.allProcessedFrameNum++;
                    }

                    // PROCESSING FOR EACH BLOCK (128 samples)
                    // After larger samples than delay-time are stored
                    if (this.allProcessedFrameNum >= this.lengthMaxSamples) {
                        // 0-255: L, 256-511: R
                        this.delayedSigCh = ((this.poly * ch) + (this.allProcessedBlockNum % this.poly));

                        // Trim samples to be delayed (call this "particle")
                        let delayedSig_aloc = this.delayedSig[this.delayedSigCh];
                        delayedSig_aloc = rawSig.slice(delayMaster, lengthMaster);

                        // Multiply the particle with a window function and set volume
                        for (let j = 0, len = delayedSig_aloc.length; j < len; j++) {
                            let phaseIndex = Math.floor(j * this.windowSize / len);

                            // Windowing
                            delayedSig_aloc[j] = delayedSig_aloc[j] * this.preparedWindow[phaseIndex * this.windowCh + wavetableCh];
                            
                            // Set volume
                            delayedSig_aloc[j] *= volumeMaster;
                            // delayedSig_aloc[j] /= this.poly;
                        }

                        // Give data back to master array
                        this.delayedSig[this.delayedSigCh] = delayedSig_aloc;

                        // Mixing
                        let finalOutput = new Array(outputCh.length).fill(0);
                        let blockNum = 0;

                        for (let k = 0; k < this.poly; k++) {

                            let delayedSig_aloc_finCh = ((this.delayedSigCh - k + this.poly) % this.poly) + (this.poly * ch);

                            if (this.delayedSig[delayedSig_aloc_finCh] != undefined) {
                                let delayedSig_aloc_fin = this.delayedSig[delayedSig_aloc_finCh];

                                // PROCESSING FOR EACH SAMPLE
                                for (let l = 0; l < outputCh.length; l++) {

                                    finalOutput[l] += delayedSig_aloc_fin[blockNum * outputCh.length + l] || 0;
                                }

                                blockNum++;
                            }
                        }

                        output[ch].set(finalOutput);
                    }

                    if (ch === 1) this.allProcessedBlockNum++;
                }

            }
        }

        return true;
    }
}

registerProcessor('particleRev', ParticleRev);