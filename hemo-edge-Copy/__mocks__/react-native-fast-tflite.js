export const loadTensorflowModel = async () => {
  console.warn('HEMO-EDGE: TFLite is not supported on Web. Using mock model.');
  return {
    run: async () => [new Float32Array([0.99])],
  };
};
