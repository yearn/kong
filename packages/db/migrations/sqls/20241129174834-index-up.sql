CREATE INDEX idx_output_chain_id_address ON output (chain_id, address);
CREATE INDEX idx_output_label_component_block_time ON output (label, component, block_time DESC);
CREATE INDEX idx_thing_chain_id_address_defaults ON thing (chain_id, address) WHERE defaults->>'yearn' = 'true';
