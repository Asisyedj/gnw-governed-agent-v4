"""
GNW GPU Mesh Orchestrator
perf(pipeline): High-performance Python pipeline with NVIDIA cuDF, PySpark Rapids, VRAM profiling
"""

import os
import sys
import json
import time
import logging
import hashlib
import threading
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager

import numpy as np

# Optional imports with fallbacks
try:
    import cudf
    import cupy as cp
    CUDF_AVAILABLE = True
except ImportError:
    CUDF_AVAILABLE = False
    logging.warning("cuDF not available, falling back to pandas")
    import pandas as pd

try:
    from pyspark.sql import SparkSession
    from pyspark.sql.functions import col, udf
    from pyspark.sql.types import StructType, StructField, StringType, DoubleType
    PYSPARK_AVAILABLE = True
except ImportError:
    PYSPARK_AVAILABLE = False
    logging.warning("PySpark not available")

try:
    import pynvml
    NVML_AVAILABLE = True
    pynvml.nvmlInit()
    device_count = pynvml.nvmlDeviceGetCount()
    handles = [pynvml.nvmlDeviceGetHandleByIndex(i) for i in range(device_count)]
except ImportError:
    NVML_AVAILABLE = False
    logging.warning("pynvml not available, VRAM profiling disabled")
    handles = []

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class VRAMProfile:
    """VRAM profiling results"""
    device_id: int
    total_memory: int
    used_memory: int
    free_memory: int
    utilization: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class PipelineTask:
    """GPU pipeline task definition"""
    task_id: str
    data_hash: str
    payload: Dict[str, Any]
    priority: int = 0
    retries: int = 0
    max_retries: int = 3


@dataclass
class PipelineResult:
    """GPU pipeline execution result"""
    task_id: str
    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None
    execution_time_ms: float = 0.0
    vram_profile: Optional[VRAMProfile] = None


class DynamicVRAMProfiler:
    """Dynamic VRAM profiling for GPU memory management"""

    def __init__(self):
        self.profiles: List[VRAMProfile] = []
        self.lock = threading.Lock()

    def profile(self, device_id: int = 0) -> Optional[VRAMProfile]:
        """Profile VRAM for a specific device"""
        if not NVML_AVAILABLE or not handles:
            return None

        try:
            handle = handles[device_id] if device_id < len(handles) else handles[0]
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)

            profile = VRAMProfile(
                device_id=device_id,
                total_memory=info.total,
                used_memory=info.used,
                free_memory=info.free,
                utilization=util.gpu,
            )

            with self.lock:
                self.profiles.append(profile)

            return profile
        except Exception as e:
            logger.warning(f"VRAM profiling failed: {e}")
            return None

    def get_optimal_device(self) -> int:
        """Select device with most free VRAM"""
        if not NVML_AVAILABLE or not handles:
            return 0

        profiles = [self.profile(i) for i in range(len(handles))]
        valid_profiles = [p for p in profiles if p is not None]

        if not valid_profiles:
            return 0

        return max(valid_profiles, key=lambda p: p.free_memory).device_id

    def should_offload(self, required_bytes: int, threshold: float = 0.8) -> bool:
        """Determine if task should be offloaded to CPU"""
        profile = self.profile()
        if not profile:
            return False

        return profile.used_memory / profile.total_memory > threshold


class GPUMeshOrchestrator:
    """High-performance GPU mesh orchestrator with cuDF and PySpark Rapids"""

    def __init__(self, max_workers: int = 4, enable_spark: bool = False):
        self.max_workers = max_workers
        self.enable_spark = enable_spark and PYSPARK_AVAILABLE
        self.profiler = DynamicVRAMProfiler()
        self.task_queue: List[PipelineTask] = []
        self.results: Dict[str, PipelineResult] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

        if self.enable_spark:
            self.spark = SparkSession.builder \
                .appName("GNW-GPU-Mesh") \
                .config("spark.plugins", "com.nvidia.spark.SQLPlugin") \
                .config("spark.rapids.sql.enabled", "true") \
                .getOrCreate()
            logger.info("PySpark Rapids enabled")
        else:
            self.spark = None

    def _compute_data_hash(self, data: Any) -> str:
        """Compute SHA-256 hash of data"""
        if isinstance(data, (dict, list)):
            data_str = json.dumps(data, sort_keys=True)
        else:
            data_str = str(data)
        return hashlib.sha256(data_str.encode()).hexdigest()[:16]

    def _execute_gpu_task(self, task: PipelineTask) -> PipelineResult:
        """Execute a single GPU task with VRAM profiling"""
        start_time = time.time()
        vram_profile = self.profiler.profile()

        try:
            # Check if should offload to CPU
            if self.profiler.should_offload(1024 * 1024 * 512):  # 512MB threshold
                logger.info(f"Task {task.task_id}: Offloading to CPU fallback")
                result = self._execute_cpu_fallback(task)
            else:
                result = self._execute_gpu_kernel(task)

            execution_time = (time.time() - start_time) * 1000

            return PipelineResult(
                task_id=task.task_id,
                success=True,
                result=result,
                execution_time_ms=execution_time,
                vram_profile=vram_profile,
            )

        except Exception as e:
            execution_time = (time.time() - start_time) * 1000
            logger.error(f"Task {task.task_id} failed: {e}")

            return PipelineResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                execution_time_ms=execution_time,
                vram_profile=vram_profile,
            )

    def _execute_gpu_kernel(self, task: PipelineTask) -> Any:
        """Execute GPU kernel with cuDF"""
        if CUDF_AVAILABLE:
            # Example cuDF operation
            df = cudf.DataFrame(task.payload.get('data', {}))
            # Perform GPU-accelerated transformation
            result = df.groupby('category').agg({'value': 'sum'})
            return result.to_pandas().to_dict() if hasattr(result, 'to_pandas') else result.to_dict()
        else:
            return self._execute_cpu_fallback(task)

    def _execute_cpu_fallback(self, task: PipelineTask) -> Any:
        """CPU fallback for edge/local environments (Termux)"""
        logger.info(f"Task {task.task_id}: Using CPU fallback")
        if CUDF_AVAILABLE:
            import pandas as pd
            df = pd.DataFrame(task.payload.get('data', {}))
            result = df.groupby('category').agg({'value': 'sum'})
            return result.to_dict()
        else:
            return {'fallback': True, 'task_id': task.task_id}

    def submit(self, task: PipelineTask) -> str:
        """Submit a task for execution"""
        with self.lock:
            self.task_queue.append(task)
        return task.task_id

    def execute_all(self) -> List[PipelineResult]:
        """Execute all queued tasks concurrently"""
        futures = []

        for task in self.task_queue:
            future = self.executor.submit(self._execute_gpu_task, task)
            futures.append(future)

        results = []
        for future in as_completed(futures):
            try:
                result = future.result()
                results.append(result)
                with self.lock:
                    self.results[result.task_id] = result
            except Exception as e:
                logger.error(f"Future execution failed: {e}")

        self.task_queue.clear()
        return results

    def get_vram_profile(self) -> Optional[VRAMProfile]:
        """Get current VRAM profile"""
        return self.profiler.profile()

    def shutdown(self):
        """Gracefully shutdown orchestrator"""
        self.executor.shutdown(wait=True)
        if self.spark:
            self.spark.stop()
        if NVML_AVAILABLE:
            pynvml.nvmlShutdown()


@contextmanager
def gpu_mesh_context(max_workers: int = 4, enable_spark: bool = False):
    """Context manager for GPU mesh orchestrator"""
    orchestrator = GPUMeshOrchestrator(max_workers=max_workers, enable_spark=enable_spark)
    try:
        yield orchestrator
    finally:
        orchestrator.shutdown()


def main():
    """Example usage"""
    with gpu_mesh_context(max_workers=4, enable_spark=False) as orchestrator:
        # Submit tasks
        for i in range(5):
            task = PipelineTask(
                task_id=f"task_{i}",
                data_hash=hashlib.sha256(f"data_{i}".encode()).hexdigest()[:16],
                payload={'data': {'category': ['A', 'B', 'A'], 'value': [1, 2, 3]}},
                priority=i,
            )
            orchestrator.submit(task)

        # Execute
        results = orchestrator.execute_all()

        for result in results:
            logger.info(
                f"Task {result.task_id}: "
                f"success={result.success}, "
                f"time={result.execution_time_ms:.2f}ms"
            )

            if result.vram_profile:
                logger.info(
                    f"  VRAM: used={result.vram_profile.used_memory / 1024 / 1024:.2f}MB, "
                    f"free={result.vram_profile.free_memory / 1024 / 1024:.2f}MB"
                )


if __name__ == "__main__":
    main()
