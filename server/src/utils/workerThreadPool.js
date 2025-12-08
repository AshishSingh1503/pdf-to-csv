import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WorkerThreadPool extends EventEmitter {
    constructor(poolSize, workerPath) {
        super();
        this.poolSize = poolSize || 4;
        // Default to validations.worker.js if not provided
        this.workerPath = workerPath || path.resolve(__dirname, '../services/validations.worker.js');
        this.workers = [];
        this.freeWorkers = [];
        this.queue = [];
        this.activeTasks = new Map(); // taskId -> { resolve, reject, worker }

        this.init();
    }

    init() {
        for (let i = 0; i < this.poolSize; i++) {
            this.addNewWorker(i);
        }
    }

    addNewWorker(id) {
        const worker = new Worker(this.workerPath);

        worker.on('message', (message) => {
            this.onWorkerMessage(worker, message);
        });

        worker.on('error', (err) => {
            console.error(`Worker ${id} error:`, err);
            this.handleWorkerError(worker, err);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`Worker ${id} stopped with exit code ${code}`);
            }
            // Remove from lists and replace if pool is still active
            this.cleanupWorker(worker);
            // Optional: Replace worker if unsuspecting crash? 
            // For now, simpler to just let it die or handle via health checks.
            // But let's simple replace it to keep pool size.
            // this.addNewWorker(id); 
        });

        this.workers.push(worker);
        this.freeWorkers.push(worker);
        this.emit('workerReady');
        this.processQueue();
    }

    processQueue() {
        if (this.queue.length === 0 || this.freeWorkers.length === 0) return;

        const worker = this.freeWorkers.shift();
        const task = this.queue.shift();

        // Store task info to resolve promise later
        // For simplicity, we assume one message out = one message back.
        // We attach a temporary 'task' property to worker to track what it's doing
        worker.currentTask = task;

        worker.postMessage(task.data);
    }

    runTask(data) {
        return new Promise((resolve, reject) => {
            const task = { data, resolve, reject };
            if (this.freeWorkers.length > 0) {
                const worker = this.freeWorkers.shift();
                worker.currentTask = task;
                worker.postMessage(data);
            } else {
                this.queue.push(task);
            }
        });
    }

    onWorkerMessage(worker, message) {
        const task = worker.currentTask;
        if (task) {
            if (message.error) {
                task.reject(new Error(message.error));
            } else {
                task.resolve(message);
            }
            delete worker.currentTask;
        }

        this.freeWorkers.push(worker);
        this.processQueue();
    }

    handleWorkerError(worker, error) {
        const task = worker.currentTask;
        if (task) {
            task.reject(error);
            delete worker.currentTask;
        }
        // Worker is likely dead or in bad state, ensure it's removed and replaced
        this.cleanupWorker(worker);
        // Replace logic could go here
    }

    cleanupWorker(worker) {
        this.workers = this.workers.filter(w => w !== worker);
        this.freeWorkers = this.freeWorkers.filter(w => w !== worker);
    }

    async terminate() {
        this.queue = []; // Clear queue
        const promises = this.workers.map(w => w.terminate());
        await Promise.all(promises);
        this.workers = [];
        this.freeWorkers = [];
    }
}
