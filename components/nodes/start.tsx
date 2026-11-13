import { NodeShell } from '../node_utils/node_shell';
import { PlayCircle, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { useFlowStore, AppNode, AppNodeProp } from '@/lib/store';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { set, cloneDeep, snakeCase } from 'lodash'
import { AppContext, NodeMetaData, Controller, NodeOutput, NodeLogViewProps } from '@/lib/nodes';

import { trimStrings } from '@/lib/utils';

import ConfirmAlert from '../ui/confirm_alert';

type Property = { name: string; type: string };
type PropValues = {
    [k: string]: string | number | undefined;
}

export const Metadata: NodeMetaData = {
    type: 'start',
    category: 'start',
    icon: PlayCircle,
    name: 'Start',
    description: 'Where the flow begins. Add the inputs the flow needs here.',
    tags: [],
    notAddable: true
}

export function LogView({payload}: NodeLogViewProps<PropValues>) {
    return <div className='bg-accent p-2 text-xs rounded-md border border-border'>
        {Object.entries(payload).filter(x=> x[0] != 'state').map(([key,value],index) => (
            <div key={index}>
                {key} : {trimStrings(value?.toString())}
            </div>
        ))}
    </div>;
}

export const Outputs = (node: AppNode) => {
    const outputs = {} as NodeOutput
    const props = node.data.properties as Property[] || []
    const propValue = node.data.propertyValues as { [key: string]: string } || {}

    // Every input can be referenced, even before it has a value (it is filled in at run time).
    for (const prop of props) {
        if (!prop.name) continue
        outputs[snakeCase(prop.name)] = {
            title: prop.name,
            value: propValue[prop.name] ?? ''
        }
    }

    return outputs;
}

export const Process = async (context: AppContext, node: AppNode, nextNodes: AppNode[], controller: Controller) => {
    const payload = Object.fromEntries(Object.entries(Outputs(node)).map(([key,value]) => [key, value.value]))
    context[node.id] = payload
    if (Object.keys(payload).length)
    controller.log({
        id: node.id,
        type: 'info',
        title: "Started with these inputs",
        nodeType: node.type,
        payload
    });
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode }) => {
    const existingProperties = (node.data.properties || []) as Property[];
    const existingPropertyValues = (node.data.propertyValues || {}) as { [key: string]: string | number | undefined | string[] };

    const [deleteProperty, setDeleteProperty] = useState<Property>();
    const [properties, setProperties] = useState<Property[]>(existingProperties);
    const [propertyValues, setPropertyValues] = useState<{ [key: string]: string | number | undefined | string[] }>(existingPropertyValues);
    const [selectedType, setSelectedType] = useState<string>();

    const updateNode = useFlowStore(state => state.updateNode);

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        const newProperty = {
            name: formData.get('name') as string,
            type: formData.get('type') as string
        };
        setProperties([...properties, newProperty]);
        const clonedNode = cloneDeep(node);
        set(clonedNode, 'data.properties', [...properties, newProperty]);
        updateNode(clonedNode);
        setSelectedType(undefined);
        (e.target as HTMLFormElement).reset();
    };
    const handleDelete = (prop: Property, force: boolean = false) => {
        const value = propertyValues[prop.name];
        if (!force && (value || Array.isArray(value) && value.length > 0)) {
            setDeleteProperty(prop);
            return;
        }

        const updatedProperties = properties.filter((p) => p.name !== prop.name);
        setDeleteProperty(undefined);
        setProperties(updatedProperties);
        setPropertyValues({
            ...propertyValues,
            [prop.name]: undefined
        });
        const clonedNode = cloneDeep(node);
        set(clonedNode, 'data.properties', updatedProperties);
        set(clonedNode, `data.propertyValues.${prop.name}`, undefined);
        updateNode(clonedNode);
    };

    const renderInput = (prop: { name: string; type: string }) => {
        const value = propertyValues[prop.name] || '';
        const arrayValue = propertyValues[prop.name] as string[] || []; // Get array value for the property
        const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setPropertyValues({
                ...propertyValues,
                [prop.name]: e.target.value
            });
            const clonedNode = cloneDeep(node);
            set(clonedNode, `data.propertyValues.${prop.name}`, e.target.value);
            updateNode(clonedNode);
        };

        const handleArrayChange = (propName: string, value: string) => {
            const updatedArray = [...(propertyValues[propName] as string[] || []), value];
            setPropertyValues(prev => ({
                ...prev,
                [propName]: updatedArray // Store array values in propertyValues
            }));
            const clonedNode = cloneDeep(node);
            set(clonedNode, `data.propertyValues.${propName}`, updatedArray);
            updateNode(clonedNode);
        };
    
        const handleRemoveFromArray = (propName: string, value: string) => {
            const updatedArray = (propertyValues[propName] as string[] || []).filter(item => item !== value);
            setPropertyValues(prev => ({
                ...prev,
                [propName]: updatedArray // Update the array in propertyValues
            }));
            const clonedNode = cloneDeep(node);
            set(clonedNode, `data.propertyValues.${propName}`, updatedArray);
            updateNode(clonedNode);
        };
    

        switch (prop.type) {
            case 'textarea':
                return <Textarea id={prop.name} className='' placeholder={prop.name} value={value} onChange={handleChange} />;
            case 'checkbox':
                // Stored as "yes" when checked (the checkbox's own value would always be "on").
                return <input id={prop.name} type='checkbox' checked={value === 'yes'} onChange={(e) => handleChange({ target: { value: e.target.checked ? 'yes' : '' } } as React.ChangeEvent<HTMLInputElement>)} />;
            case 'array':
                return (
                    <div>
                        <Input
                            type="text"
                            placeholder={`Type your value and press Enter`}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleArrayChange(prop.name, (e.target as HTMLInputElement).value);
                                    (e.target as HTMLInputElement).value = '';
                                }
                            }}
                        />
                        <div className='bg-accent p-2 rounded-md mt-2 flex flex-col gap-2'>
                            {arrayValue.length === 0 ? (
                                <span className="text-muted-foreground text-sm text-center">No items in the array.</span>
                            ) : (
                                arrayValue.map((val, index) => (
                                    <div key={index} className="flex items-center justify-between bg-card rounded-md p-2 text-sm ">
                                        <span>{val}</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`Remove "${val}"`}
                                            onClick={() => handleRemoveFromArray(prop.name, val)}
                                            className="text-danger hover:text-danger/80 p-0.5 h-6 w-6 ml-2"
                                        >
                                            <Trash className='w-3 h-3' />
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );
            default:
                return <Input id={prop.name} className='h-8' type={prop.type} placeholder={prop.name} value={value} onChange={handleChange} />;
        }
    };

    return (
        <div className='flex flex-col gap-3 px-3'>
            {properties.map((prop, index) => (
                <div key={index} className="flex flex-col pb-2 border-b border-border">
                    <div className="flex items-center mb-1 gap-2">
                        <Label className='text-sm font-semibold' htmlFor={prop.name}>{prop.name}</Label>
                        {prop.type === 'checkbox' ? renderInput(prop) : null}
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete the input "${prop.name}"`}
                            onClick={() => handleDelete(prop)}
                            className="text-danger hover:text-danger/80 p-0.5 h-6 w-6 ml-auto"
                        >
                            <Trash className='w-4 h-4' />
                        </Button>
                    </div>
                    {prop.type === 'checkbox' ? null : renderInput(prop)}
                </div>
            ))}
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <span className='text-xs font-semibold'>Add Inputs</span>
                <div className='flex gap-2'>
                    <Input
                        type="text"
                        placeholder="Name"
                        name="name"
                        required
                        autoComplete='off'
                    />
                    <Select
                        name='type'
                        required
                        value={selectedType}
                        onValueChange={(e) => setSelectedType(e)}
                    >
                        <SelectTrigger>
                            <SelectValue className='w-full' placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="checkbox">Checkbox</SelectItem>
                            <SelectItem value="textarea">Textarea</SelectItem>
                            <SelectItem value="array">Array</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button className='w-24' size={'icon'} type="submit" aria-label="Add input">
                        <Plus className='w-4 h-4' />
                    </Button>
                </div>
            </form>
            <ConfirmAlert
                open={!!deleteProperty}
                title="Delete this input?"
                description="Steps that use this input will get an empty value."
                confirmLabel="Delete input"
                destructive
                onConfirm={() => handleDelete(deleteProperty as Property, true)}
                onCancel={() => setDeleteProperty(undefined)}
            />
        </div>
    );
};

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={'Start'} category={Metadata.category} targetType='none' />
}