/* eslint-disable no-undef */
import * as _ from 'lodash-es';
import * as classNames from 'classnames';
import * as fuzzy from 'fuzzysearch';
import * as PropTypes from 'prop-types';
import * as React from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';

import { Table as PfTable, TableHeader, TableBody, sortable, SortByDirection } from '@patternfly/react-table';
import SimpleToolbarDemo from './toolbar-demo';

import { alertState, alertStateOrder, silenceState, silenceStateOrder } from '../../monitoring';
import { UIActions } from '../../ui/ui-actions';
import { ingressValidHosts } from '../ingress';
import { routeStatus } from '../routes';
import { getClusterOperatorStatus } from '../cluster-settings/cluster-operator';
import { secretTypeFilterReducer } from '../secret';
import { bindingType, roleType } from '../RBAC';
import {
  containerLinuxUpdateOperator,
  EmptyBox,
  LabelList,
  ResourceKebab,
  ResourceLink,
  resourcePath,
  Selector,
  StatusBox,
} from '../utils';
import {
  getJobTypeAndCompletions,
  nodeStatus,
  K8sKind,
  K8sResourceKind,
  K8sResourceKindReference,
  planExternalName,
  podPhase,
  podPhaseFilterReducer,
  podReadiness,
  serviceCatalogStatus,
  serviceClassDisplayName,
} from '../../module/k8s';

const fuzzyCaseInsensitive = (a, b) => fuzzy(_.toLower(a), _.toLower(b));

// TODO: Having list filters here is undocumented, stringly-typed, and non-obvious. We can change that
const listFilters = {
  'name': (filter, obj) => fuzzyCaseInsensitive(filter, obj.metadata.name),

  'alert-name': (filter, alert) => fuzzyCaseInsensitive(filter, _.get(alert, 'labels.alertname')),

  'alert-state': (filter, alert) => filter.selected.has(alertState(alert)),

  'silence-name': (filter, silence) => fuzzyCaseInsensitive(filter, silence.name),

  'silence-state': (filter, silence) => filter.selected.has(silenceState(silence)),

  // Filter role by role kind
  'role-kind': (filter, role) => filter.selected.has(roleType(role)),

  // Filter role bindings by role kind
  'role-binding-kind': (filter, binding) => filter.selected.has(bindingType(binding)),

  // Filter role bindings by text match
  'role-binding': (str, {metadata, roleRef, subject}) => {
    const isMatch = val => fuzzyCaseInsensitive(str, val);
    return [metadata.name, roleRef.name, subject.kind, subject.name].some(isMatch);
  },

  // Filter role bindings by roleRef name
  'role-binding-roleRef': (roleRef, binding) => binding.roleRef.name === roleRef,

  'selector': (selector, obj) => {
    if (!selector || !selector.values || !selector.values.size) {
      return true;
    }
    return selector.values.has(_.get(obj, selector.field));
  },

  'pod-status': (phases, pod) => {
    if (!phases || !phases.selected || !phases.selected.size) {
      return true;
    }

    const phase = podPhaseFilterReducer(pod);
    return phases.selected.has(phase) || !_.includes(phases.all, phase);
  },

  'node-status': (statuses, node) => {
    if (!statuses || !statuses.selected || !statuses.selected.size) {
      return true;
    }

    const status = nodeStatus(node);
    return statuses.selected.has(status) || !_.includes(statuses.all, status);
  },

  'clusterserviceversion-resource-kind': (filters, resource) => {
    if (!filters || !filters.selected || !filters.selected.size) {
      return true;
    }
    return filters.selected.has(resource.kind);
  },
  'clusterserviceversion-status': (filters, csv) => {
    if (!filters || !filters.selected || !filters.selected.size) {
      return true;
    }
    return filters.selected.has(_.get(csv.status, 'reason')) || !_.includes(filters.all, _.get(csv.status, 'reason'));
  },

  'build-status': (phases, build) => {
    if (!phases || !phases.selected || !phases.selected.size) {
      return true;
    }

    const phase = build.status.phase;
    return phases.selected.has(phase) || !_.includes(phases.all, phase);
  },

  'build-strategy': (strategies, buildConfig) => {
    if (!strategies || !strategies.selected || !strategies.selected.size) {
      return true;
    }

    const strategy = buildConfig.spec.strategy.type;
    return strategies.selected.has(strategy) || !_.includes(strategies.all, strategy);
  },

  'route-status': (statuses, route) => {
    if (!statuses || !statuses.selected || !statuses.selected.size) {
      return true;
    }

    const status = routeStatus(route);
    return statuses.selected.has(status) || !_.includes(statuses.all, status);
  },

  'catalog-status': (statuses, catalog) => {
    if (!statuses || !statuses.selected || !statuses.selected.size) {
      return true;
    }

    const status = serviceCatalogStatus(catalog);
    return statuses.selected.has(status) || !_.includes(statuses.all, status);
  },

  'secret-type': (types, secret) => {
    if (!types || !types.selected || !types.selected.size) {
      return true;
    }
    const type = secretTypeFilterReducer(secret);
    return types.selected.has(type) || !_.includes(types.all, type);
  },

  'pvc-status': (phases, pvc) => {
    if (!phases || !phases.selected || !phases.selected.size) {
      return true;
    }

    const phase = pvc.status.phase;
    return phases.selected.has(phase) || !_.includes(phases.all, phase);
  },

  // Filter service classes by text match
  'service-class': (str, serviceClass) => {
    const displayName = serviceClassDisplayName(serviceClass);
    return fuzzyCaseInsensitive(str, displayName);
  },

  'cluster-operator-status': (statuses, operator) => {
    if (!statuses || !statuses.selected || !statuses.selected.size) {
      return true;
    }

    const status = getClusterOperatorStatus(operator);
    return statuses.selected.has(status) || !_.includes(statuses.all, status);
  },
};

const getFilteredRows = (_filters, objects) => {
  if (_.isEmpty(_filters)) {
    return objects;
  }

  _.each(_filters, (value, name) => {
    const filter = listFilters[name];
    if (_.isFunction(filter)) {
      objects = _.filter(objects, o => filter(value, o));
    }
  });

  return objects;
};

const filterPropType = (props, propName, componentName) => {
  if (!props) {
    return;
  }

  for (const key of _.keys(props[propName])) {
    if (key in listFilters || key === 'loadTest') {
      continue;
    }
    return new Error(`Invalid prop '${propName}' in '${componentName}'. '${key}' is not a valid filter type!`);
  }
};

const sorts = {
  alertStateOrder,
  daemonsetNumScheduled: daemonset => _.toInteger(_.get(daemonset, 'status.currentNumberScheduled')),
  dataSize: resource => _.size(_.get(resource, 'data')),
  ingressValidHosts,
  serviceCatalogStatus,
  jobCompletions: job => getJobTypeAndCompletions(job).completions,
  jobType: job => getJobTypeAndCompletions(job).type,
  nodeReadiness: node => {
    let readiness = _.get(node, 'status.conditions');
    readiness = _.find(readiness, {type: 'Ready'});
    return _.get(readiness, 'status');
  },
  nodeUpdateStatus: node => _.get(containerLinuxUpdateOperator.getUpdateStatus(node), 'text'),
  numReplicas: resource => _.toInteger(_.get(resource, 'status.replicas')),
  planExternalName,
  podPhase,
  podReadiness,
  serviceClassDisplayName,
  silenceStateOrder,
  string: val => JSON.stringify(val),
};
const stateToProps = ({UI}, {data = [], defaultSortField = 'metadata.name', defaultSortFunc = undefined, filters = {}, loaded = false, reduxID = null, reduxIDs = null, staticFilters = [{}]}) => {
  const allFilters = staticFilters ? Object.assign({}, filters, ...staticFilters) : filters;
  let newData = getFilteredRows(allFilters, data);

  const listId = reduxIDs ? reduxIDs.join(',') : reduxID;
  // Only default to 'metadata.name' if no `defaultSortFunc`
  const currentSortField = UI.getIn(['listSorts', listId, 'field'], defaultSortFunc ? undefined : defaultSortField);
  const currentSortFunc = UI.getIn(['listSorts', listId, 'func'], defaultSortFunc);
  const currentSortOrder = UI.getIn(['listSorts', listId, 'orderBy'], 'asc');

  if (loaded) {
    let sortBy: string | Function = 'metadata.name';
    if (currentSortField) {
      // Sort resources by one of their fields as a string
      sortBy = resource => sorts.string(_.get(resource, currentSortField, ''));
    } else if (currentSortFunc && sorts[currentSortFunc]) {
      // Sort resources by a function in the 'sorts' object
      sortBy = sorts[currentSortFunc];
    }

    // Always set the secondary sort criteria to ascending by name
    newData = _.orderBy(newData, [sortBy, 'metadata.name'], [currentSortOrder, 'asc']);
  }

  return {
    currentSortField,
    currentSortFunc,
    currentSortOrder,
    data: newData,
    listId,
  };
};

export const Table = connect(stateToProps, {sortList: UIActions.sortList})(
  class TableInner extends React.Component<TableInnerProps> {
    static propTypes = {
      data: PropTypes.array,
      EmptyMsg: PropTypes.func,
      expand: PropTypes.bool,
      fieldSelector: PropTypes.string,
      filters: filterPropType,
      Header: PropTypes.func.isRequired,
      Rows: PropTypes.func.isRequired,
      loaded: PropTypes.bool,
      loadError: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
      mock: PropTypes.bool,
      namespace: PropTypes.string,
      reduxID: PropTypes.string,
      reduxIDs: PropTypes.array,
      selector: PropTypes.object,
      staticFilters: PropTypes.array,
      virtualize: PropTypes.bool,
      currentSortField: PropTypes.string,
      currentSortFunc: PropTypes.string,
      currentSortOrder: PropTypes.any,
      defaultSortField: PropTypes.string,
      defaultSortFunc: PropTypes.string,
      label: PropTypes.string,
      listId: PropTypes.string,
      sortList: PropTypes.func,
      onSelect: PropTypes.func
    };

    render() {
      const {currentSortField, currentSortFunc, currentSortOrder, expand, Header, Rows, label, listId, mock, sortList, onSelect} = this.props;
      const componentProps: any = _.pick(this.props, ['data', 'filters', 'selected', 'match', 'kindObj']);

      const columns = Header(componentProps);
      const rows = Rows(componentProps);

      return (
        <React.Fragment>
          <SimpleToolbarDemo />
          <PfTable cells={columns} rows={rows} onSelect={onSelect}>
            <TableHeader />
            <TableBody />
          </PfTable>
        </React.Fragment>
      );
    }
  });


export type TableInnerProps = {
  currentSortField?: string;
  currentSortFunc?: string;
  currentSortOrder?: any;
  data?: any[];
  defaultSortField?: string;
  defaultSortFunc?: string;
  EmptyMsg?: React.ComponentType<{}>;
  expand?: boolean;
  fieldSelector?: string;
  filters?: {[name: string]: any};
  Header: React.ComponentType<any>;
  label?: string;
  listId?: string;
  loaded?: boolean;
  loadError?: string | Object;
  mock?: boolean;
  namespace?: string;
  reduxID?: string;
  reduxIDs?: string[];
  Row: React.ComponentType<any>;
  selector?: Object;
  sortList?: (...args) => any;
  staticFilters?: any[];
  virtualize?: boolean;
};

